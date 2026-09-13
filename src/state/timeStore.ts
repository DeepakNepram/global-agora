import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { wallClockNow } from './clock';

/**
 * How often live mode re-reads the wall clock. The terminator moves 0.25° per
 * minute, so 30 seconds is 0.125° — invisible inside its ~11°-wide soft band —
 * and costs one rendered frame.
 */
export const LIVE_SYNC_INTERVAL_MS = 30_000;

export interface TimeState {
  /** The instant the globe depicts, in epoch milliseconds (UTC). */
  readonly timeMs: number;
  /** True while timeMs follows the wall clock rather than a scrubbed value. */
  readonly isLive: boolean;
  /** Show a specific instant. Leaves live mode. */
  setTime(ms: number): void;
  /** Jump to now and keep following the wall clock. */
  goLive(): void;
  /** Re-read the wall clock if live; a no-op while scrubbed. */
  syncLive(): void;
}

export type TimeStore = StoreApi<TimeState>;

/**
 * Time, not sun direction, is the stored value: the sun is derived from it with
 * src/core's sunDirection, and the scrubber and pin fading will read the same
 * instant. Plain data only, so a slider can write it at 60Hz without anything
 * allocating.
 *
 * The clock is injected so tests control it; the app uses wallClockNow.
 */
export function createTimeStore(now: () => number = wallClockNow): TimeStore {
  return createStore<TimeState>()((set, get) => ({
    timeMs: now(),
    isLive: true,

    setTime(ms) {
      if (!Number.isFinite(ms)) return;
      set({ timeMs: ms, isLive: false });
    },

    goLive() {
      set({ timeMs: now(), isLive: true });
    },

    syncLive() {
      if (get().isLive) set({ timeMs: now() });
    },
  }));
}

/** The app's single time store. */
export const timeStore: TimeStore = createTimeStore();

/**
 * React binding. Components that only feed the renderer should prefer
 * timeStore.subscribe, which does not re-render on every change.
 */
export function useTimeStore<T>(selector: (state: TimeState) => T): T {
  return useStore(timeStore, selector);
}
