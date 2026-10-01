import { useEffect, useMemo, useRef, useState } from 'react';

import {
  CLUSTER_DEBOUNCE_MS,
  createClusterClient,
  type ClusterClient,
  type ClusterLayout,
  type ClusterReply,
  type NodeBuffer,
} from '@/core';
import { timeStore, type TimeMotion } from '@/state';

function isTimeMoving(motion: TimeMotion): boolean {
  return motion !== 'still';
}

export interface ClusterFeedOptions {
  /** The stories to cluster; null while clustering is off or nothing has loaded. */
  readonly nodes: NodeBuffer | null;
  /** The level to ask for before the camera reports one. */
  readonly initialLevel: number;
  readonly onLayout: (nodes: NodeBuffer, layout: ClusterLayout) => void;
}

export interface ClusterFeed {
  /** The level the camera is at; the client debounces the question. */
  setLevel(level: number): void;
  /** The worker could not run: show every story unclustered rather than none. */
  readonly failed: boolean;
}

/**
 * Runs the clustering Web Worker while there are stories to cluster, and
 * connects it to the cluster client: new payloads, the displayed instant and
 * whether the time is moving go in, layouts come back through onLayout. While
 * a drag or Play moves the time the clusters stay open, so every story shows
 * its own appearance and the worker is asked nothing (DECISIONS, 3.2).
 */
export function useClusterFeed({ nodes, initialLevel, onLayout }: ClusterFeedOptions): ClusterFeed {
  const clientRef = useRef<ClusterClient | null>(null);
  const levelRef = useRef(initialLevel);
  const onLayoutRef = useRef(onLayout);
  const [failed, setFailed] = useState(() => typeof Worker === 'undefined');
  const active = nodes !== null && !failed;

  useEffect(() => {
    onLayoutRef.current = onLayout;
  }, [onLayout]);

  useEffect(() => {
    if (!active) return;
    const worker = new Worker(new URL('../data/cluster.worker.ts', import.meta.url), {
      type: 'module',
      name: 'clusters',
    });
    const client = createClusterClient({
      post: (request) => worker.postMessage(request),
      timers: {
        set: (callback, ms) => window.setTimeout(callback, ms),
        clear: (handle) => window.clearTimeout(handle as number),
      },
      debounceMs: CLUSTER_DEBOUNCE_MS,
      initialLevel: levelRef.current,
      onLayout: (shown, layout) => onLayoutRef.current(shown, layout),
      onError: (message) =>
        console.warn('Clustering failed; retrying on the next change.', message),
    });
    worker.onmessage = (event: MessageEvent<ClusterReply>) => client.receive(event.data);
    worker.onerror = (event) => {
      console.warn(
        'The clustering worker stopped; showing every story unclustered.',
        event.message,
      );
      setFailed(true);
    };
    clientRef.current = client;
    client.setOpen(isTimeMoving(timeStore.getState().motion));
    return () => {
      clientRef.current = null;
      client.dispose();
      worker.terminate();
    };
  }, [active]);

  useEffect(() => {
    if (nodes && active) clientRef.current?.load(nodes, timeStore.getState().timeMs / 1000);
  }, [nodes, active]);

  // Outside React, like the pins' own uniform: at rest a time step asks for a
  // new layout only when a story crosses its publish time; a drag or Play
  // opens the clusters and asks nothing until it stops.
  useEffect(
    () =>
      timeStore.subscribe((state, previous) => {
        const client = clientRef.current;
        if (!client) return;
        if (state.timeMs !== previous.timeMs) client.setTime(state.timeMs / 1000);
        if (state.motion !== previous.motion) client.setOpen(isTimeMoving(state.motion));
      }),
    [],
  );

  return useMemo(
    () => ({
      setLevel(level: number) {
        levelRef.current = level;
        clientRef.current?.setLevel(level);
      },
      failed,
    }),
    [failed],
  );
}
