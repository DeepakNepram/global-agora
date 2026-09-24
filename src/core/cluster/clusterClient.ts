import type { Timers } from '../data/nodesFeed';
import type { NodeBuffer } from '../nodeBuffer';

import { countVisible, type ClusterLayout } from './layout';
import type { ClusterColumns, ClusterReply, ClusterRequest } from './protocol';

/**
 * The main thread's side of clustering. It ships each payload's columns to the
 * engine once, asks for a layout whenever the level or the set of published
 * stories changes, and hands back only the answer to its latest question.
 *
 * Level and time changes are debounced (a zoom gesture crosses levels in
 * quick succession, and only where it stops matters). A new payload is asked
 * about at once. The port and timers are injected: no Worker or DOM here, so
 * tests run it synchronously and a native shell can host the engine however
 * it likes.
 */

export interface ClusterClientOptions {
  /** Delivers a request to the engine, e.g. worker.postMessage. */
  readonly post: (request: ClusterRequest) => void;
  readonly timers: Timers;
  readonly debounceMs: number;
  /** The level to ask for until setLevel says otherwise. */
  readonly initialLevel: number;
  /** The latest layout, with the NodeBuffer its rows index. */
  readonly onLayout: (nodes: NodeBuffer, layout: ClusterLayout) => void;
  readonly onError?: (message: string) => void;
}

export interface ClusterClient {
  /** A new payload (or source): clustered and laid out without waiting for the debounce. */
  load(nodes: NodeBuffer, nowSec: number): void;
  setLevel(level: number): void;
  /** The displayed instant; a new layout only if a story crossed its publish time. */
  setTime(nowSec: number): void;
  /** Feed every engine reply here, e.g. from worker.onmessage. */
  receive(reply: ClusterReply): void;
  dispose(): void;
}

/** Exactly `count` rows, copied, so the clone sent to the worker holds no spare capacity. */
export function clusterColumns(nodes: NodeBuffer): ClusterColumns {
  const { count } = nodes;
  return {
    count,
    epochSec: nodes.epochSec,
    ids: nodes.ids.slice(0, count),
    positions: nodes.positions.slice(0, count * 3),
    heat: nodes.heat.slice(0, count),
    categories: nodes.categories.slice(0, count),
    publishedSec: nodes.publishedSec.slice(0, count),
  };
}

interface Asked {
  readonly generation: number;
  readonly level: number;
  readonly visible: number;
}

export function createClusterClient(options: ClusterClientOptions): ClusterClient {
  const { post, timers, debounceMs, onLayout, onError } = options;
  let nodes: NodeBuffer | null = null;
  let generation = 0;
  let level = options.initialLevel;
  let nowSec = 0;
  let visible = 0;
  let latest = 0;
  let asked: Asked | null = null;
  let timer: unknown = null;
  let disposed = false;

  const cancel = (): void => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  const ask = (): void => {
    cancel();
    if (!nodes || disposed) return;
    // Back where the last question left off (a level crossed and uncrossed
    // within the debounce): that answer is already on its way.
    if (asked?.generation === generation && asked.level === level && asked.visible === visible) {
      return;
    }
    latest += 1;
    asked = { generation, level, visible };
    post({ type: 'layout', generation, request: latest, level, nowSec });
  };

  const schedule = (): void => {
    cancel();
    timer = timers.set(() => {
      timer = null;
      ask();
    }, debounceMs);
  };

  return {
    load(next, now) {
      if (disposed) return;
      generation += 1;
      nodes = next;
      nowSec = now;
      visible = countVisible(next, now);
      post({ type: 'load', generation, columns: clusterColumns(next) });
      ask();
    },

    setLevel(next) {
      if (disposed || next === level) return;
      level = next;
      schedule();
    },

    setTime(now) {
      if (disposed) return;
      nowSec = now;
      if (!nodes) return;
      const next = countVisible(nodes, now);
      if (next === visible) return;
      visible = next;
      schedule();
    },

    receive(reply) {
      if (disposed || reply.request !== latest) return;
      if (reply.type === 'error') {
        onError?.(reply.message);
        return;
      }
      if (!nodes || reply.layout.generation !== generation) return;
      onLayout(nodes, reply.layout);
    },

    dispose() {
      disposed = true;
      cancel();
    },
  };
}
