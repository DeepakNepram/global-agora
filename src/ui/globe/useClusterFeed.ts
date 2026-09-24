import { useEffect, useMemo, useRef, useState } from 'react';

import {
  CLUSTER_DEBOUNCE_MS,
  createClusterClient,
  type ClusterClient,
  type ClusterLayout,
  type ClusterReply,
  type NodeBuffer,
} from '@/core';
import { timeStore } from '@/state';

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
 * connects it to the cluster client: new payloads and the displayed instant
 * go in, layouts come back through onLayout.
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
    return () => {
      clientRef.current = null;
      client.dispose();
      worker.terminate();
    };
  }, [active]);

  useEffect(() => {
    if (nodes && active) clientRef.current?.load(nodes, timeStore.getState().timeMs / 1000);
  }, [nodes, active]);

  // Outside React, like the pins' own retime: a scrub asks for a new layout
  // only when a story crosses its publish time.
  useEffect(
    () =>
      timeStore.subscribe((state, previous) => {
        if (state.timeMs !== previous.timeMs) clientRef.current?.setTime(state.timeMs / 1000);
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
