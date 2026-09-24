import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { NodeBuffer } from '@/core';

import { wallClockNow } from './clock';

/**
 * The stories on the globe, as the payload feed last delivered them.
 *
 * A NodeBuffer is replaced whole on each update, never mutated in place, so a
 * subscriber comparing references sees every change and nothing else.
 */

export type NodesStatus = 'loading' | 'ready' | 'error';

export interface NodesState {
  readonly nodes: NodeBuffer | null;
  /** 'error' only while there is nothing to show; a failed refresh keeps 'ready'. */
  readonly status: NodesStatus;
  readonly etag: string | null;
  /** Consecutive failed checks; 0 after any success. */
  readonly failures: number;
  /** When the payload was last confirmed current (epoch ms), or null before the first. */
  readonly checkedAtMs: number | null;
  loaded(nodes: NodeBuffer, etag: string | null): void;
  unchanged(etag: string | null): void;
  failed(failures: number): void;
}

export type NodesStore = StoreApi<NodesState>;

/** The clock is injected so tests control it; the app uses wallClockNow. */
export function createNodesStore(now: () => number = wallClockNow): NodesStore {
  return createStore<NodesState>()((set, get) => ({
    nodes: null,
    status: 'loading',
    etag: null,
    failures: 0,
    checkedAtMs: null,

    loaded(nodes, etag) {
      set({ nodes, etag, status: 'ready', failures: 0, checkedAtMs: now() });
    },

    unchanged(etag) {
      set({ etag, status: 'ready', failures: 0, checkedAtMs: now() });
    },

    failed(failures) {
      set({ failures, status: get().nodes === null ? 'error' : 'ready' });
    },
  }));
}

/** The app's single stories store. */
export const nodesStore: NodesStore = createNodesStore();

export function useNodesStore<T>(selector: (state: NodesState) => T): T {
  return useStore(nodesStore, selector);
}
