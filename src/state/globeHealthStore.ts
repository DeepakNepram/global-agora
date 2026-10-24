import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { afterContextLoss } from '@/core';

/**
 * Whether the 3D globe can be shown (Prompt 5.2), for this page load only:
 * a reload always tries the globe again.
 *
 * - `restoring`: its WebGL context was lost and a new one is on its way;
 *   `generation` counts the canvases made, and a new one remounts it.
 * - `fallback`: the flat map stands in, because the context kept being lost
 *   or the globe's rendering threw. (No WebGL at all is known before the
 *   first render; NewsView reads it from the device's capabilities.)
 */

export type GlobeFallback = 'lost' | 'crashed';

export interface GlobeHealthState {
  readonly fallback: GlobeFallback | null;
  readonly restoring: boolean;
  readonly generation: number;
  readonly lossesMs: readonly number[];
  contextLost(nowMs: number): void;
  /** A new canvas, with a new context. */
  remount(): void;
  crashed(): void;
}

export type GlobeHealthStore = StoreApi<GlobeHealthState>;

export function createGlobeHealthStore(): GlobeHealthStore {
  return createStore<GlobeHealthState>()((set, get) => ({
    fallback: null,
    restoring: false,
    generation: 0,
    lossesMs: [],
    contextLost(nowMs) {
      const { lossesMs, giveUp } = afterContextLoss(get().lossesMs, nowMs);
      set(
        giveUp ? { lossesMs, restoring: false, fallback: 'lost' } : { lossesMs, restoring: true },
      );
    },
    remount() {
      if (get().restoring) set({ restoring: false, generation: get().generation + 1 });
    },
    crashed() {
      set({ restoring: false, fallback: 'crashed' });
    },
  }));
}

export const globeHealthStore: GlobeHealthStore = createGlobeHealthStore();

export function useGlobeHealth<T>(selector: (state: GlobeHealthState) => T): T {
  return useStore(globeHealthStore, selector);
}
