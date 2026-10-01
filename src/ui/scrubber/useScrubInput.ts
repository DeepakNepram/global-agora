import {
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

import { fractionAt, historyRange, inMagnet, timeAt } from '@/core';
import { timeStore, wallClockNow } from '@/state';

/** The range input's resolution: 10,000 steps is finer than a pixel on any screen. */
export const SCRUB_STEPS = 10_000;

/** The magnet at now, in CSS pixels of track: a fingertip on a phone, a nudge on a desktop. */
export const MAGNET_CSS_PX = 32;

/**
 * A press becomes a drag once the pointer has moved this far. A tap that jumps
 * the time stays a single step: the clusters re-form at the new time without
 * blooming open and shut.
 */
export const DRAG_SLOP_CSS_PX = 6;

/** Keyboard steps through the window. */
const ARROW_STEP_MS = 15 * 60_000;
const PAGE_STEP_MS = 60 * 60_000;

export interface ScrubInputHandlers {
  readonly onPointerDown: (event: PointerEvent<HTMLInputElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLInputElement>) => void;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Turns the range input's events into time-store changes: the pointer sets
 * the time directly (no network, no re-clustering: the store fans out to the
 * sun uniform, the pin uniform and the label), the last MAGNET_CSS_PX pull it
 * back to live, and letting go holds whatever time is shown.
 */
export function useScrubInput(
  input: RefObject<HTMLInputElement | null>,
  historyHours: number,
): ScrubInputHandlers {
  const press = useRef<{ pointerId: number; startX: number } | null>(null);

  // Released anywhere: a range input does not always see its own pointerup.
  useEffect(() => {
    const release = (event: globalThis.PointerEvent): void => {
      if (press.current?.pointerId !== event.pointerId) return;
      press.current = null;
      if (timeStore.getState().motion === 'dragging') timeStore.getState().setMotion('still');
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  return useMemo(() => {
    const showFraction = (fraction: number): void => {
      const state = timeStore.getState();
      const trackPx = input.current?.getBoundingClientRect().width ?? 0;
      if (inMagnet(fraction, trackPx, MAGNET_CSS_PX)) {
        state.returnToLive();
        return;
      }
      state.setTime(timeAt(fraction, historyRange(wallClockNow(), historyHours)));
    };

    const step = (byMs: number): void => {
      const state = timeStore.getState();
      const range = historyRange(wallClockNow(), historyHours);
      const next = Math.max(state.timeMs + byMs, range.startMs);
      if (next >= range.endMs) state.returnToLive();
      else state.setTime(next);
    };

    return {
      onPointerDown(event) {
        press.current = { pointerId: event.pointerId, startX: event.clientX };
        // A hand on the scrubber takes over from Play.
        if (timeStore.getState().motion === 'playing') timeStore.getState().setMotion('still');
      },

      onPointerMove(event) {
        const pressed = press.current;
        if (!pressed || pressed.pointerId !== event.pointerId) return;
        if (Math.abs(event.clientX - pressed.startX) < DRAG_SLOP_CSS_PX) return;
        timeStore.getState().setMotion('dragging');
      },

      onChange(event) {
        showFraction(Number(event.target.value) / SCRUB_STEPS);
      },

      onKeyDown(event) {
        const state = timeStore.getState();
        const keys: Record<string, () => void> = {
          ArrowLeft: () => step(-ARROW_STEP_MS),
          ArrowDown: () => step(-ARROW_STEP_MS),
          ArrowRight: () => step(ARROW_STEP_MS),
          ArrowUp: () => step(ARROW_STEP_MS),
          PageDown: () => step(-PAGE_STEP_MS),
          PageUp: () => step(PAGE_STEP_MS),
          Home: () => state.setTime(historyRange(wallClockNow(), historyHours).startMs),
          End: () => state.returnToLive(),
        };
        const action = keys[event.key];
        if (!action) return;
        // The native range would also move by its own step; the scrubber's are in minutes.
        event.preventDefault();
        if (state.motion === 'playing') state.setMotion('still');
        action();
      },
    };
  }, [input, historyHours]);
}

/** The input's value for the displayed instant. */
export function scrubValue(timeMs: number, nowMs: number, historyHours: number): number {
  return Math.round(fractionAt(timeMs, historyRange(nowMs, historyHours)) * SCRUB_STEPS);
}
