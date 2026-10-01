import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { wallClockNow } from './clock';

/**
 * How often live mode re-reads the wall clock. The terminator moves 0.25° per
 * minute, so 30 seconds is 0.125° — invisible inside its ~11°-wide soft band —
 * and costs one rendered frame.
 */
export const LIVE_SYNC_INTERVAL_MS = 30_000;

/**
 * What is moving the time: nothing, a hand on the scrubber, or Play. While it
 * is anything but still, the globe opens its clusters so every story shows
 * its own appearance (DECISIONS, 3.2).
 */
export type TimeMotion = 'still' | 'dragging' | 'playing';

export interface TimeState {
  /** The instant the globe depicts, in epoch milliseconds (UTC). */
  readonly timeMs: number;
  /** True while timeMs follows the wall clock rather than a scrubbed value. */
  readonly isLive: boolean;
  readonly motion: TimeMotion;
  /** True while the time eases back to now; the frame driver performs it. */
  readonly returning: boolean;
  /** Show a specific instant (a drag, a key). Leaves live mode and ends a return. */
  setTime(ms: number): void;
  /** One frame of Play or of the return: leaves live mode, keeps motion and the return. */
  stepTime(ms: number): void;
  /** Jump to now and keep following the wall clock. */
  goLive(): void;
  /** Ease back to now from wherever the time is; goLive when it lands. */
  returnToLive(): void;
  setMotion(motion: TimeMotion): void;
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
    motion: 'still',
    returning: false,

    setTime(ms) {
      if (!Number.isFinite(ms)) return;
      set({ timeMs: ms, isLive: false, returning: false });
    },

    stepTime(ms) {
      if (!Number.isFinite(ms)) return;
      set({ timeMs: ms, isLive: false });
    },

    goLive() {
      set({ timeMs: now(), isLive: true, returning: false });
    },

    returnToLive() {
      // Already there: nothing to ease.
      if (get().isLive) return;
      set({ returning: true, motion: get().motion === 'playing' ? 'still' : get().motion });
    },

    setMotion(motion) {
      if (motion === get().motion) return;
      // Play replaces a return in progress; a drag may continue one (the magnet).
      set(motion === 'playing' ? { motion, returning: false } : { motion });
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
