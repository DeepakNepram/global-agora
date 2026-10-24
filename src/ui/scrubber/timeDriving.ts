import { useEffect } from 'react';

import {
  fractionAt,
  historyRange,
  playProgress,
  playSeconds,
  playStartMs,
  returnStep,
} from '@/core';
import type { MotionPreference } from '@/globe';
import { timeStore, wallClockNow } from '@/state';

/** The first step after an idle spell: the frame delta then spans the whole spell. */
const RESUME_STEP_SECONDS = 1 / 60;
/** A longer step is a backgrounded tab, not a frame. */
const MAX_STEP_SECONDS = 0.1;

interface PlayRun {
  readonly fromMs: number;
  readonly durationSec: number;
  elapsedSec: number;
}

export interface TimeDriving {
  /**
   * Moves the time store by one frame of `deltaSec` for Play (the whole
   * window in about 20 s along timeline.ts's eased curve, ending live) or
   * the eased return to live. True while another frame is needed.
   * Reduced motion lands a return at once; Play, which the viewer asked
   * for, still plays.
   */
  tick(deltaSec: number, motion: MotionPreference): boolean;
}

/**
 * The time's two animations as a per-frame step, with no clock of its own,
 * so the globe can run it on the frames it draws (TimeDriver) and the list
 * and the flat map on requestAnimationFrame (useTimeDriving).
 */
export function createTimeDriving(historyHours: number): TimeDriving {
  let run: PlayRun | null = null;
  let active = false;

  return {
    tick(deltaSec, motion) {
      const time = timeStore.getState();
      const playing = time.motion === 'playing';
      if (!playing) run = null;
      if (!playing && !time.returning) {
        active = false;
        return false;
      }
      const step = active ? Math.min(deltaSec, MAX_STEP_SECONDS) : RESUME_STEP_SECONDS;
      active = true;
      const nowMs = wallClockNow();

      if (playing) {
        if (!run) {
          const range = historyRange(nowMs, historyHours);
          const fromMs = playStartMs(time.timeMs, time.isLive, range);
          run = { fromMs, durationSec: playSeconds(fractionAt(fromMs, range)), elapsedSec: 0 };
          time.stepTime(fromMs);
          return true;
        }
        run.elapsedSec += step;
        const progress = playProgress(run.elapsedSec, run.durationSec);
        if (progress >= 1) {
          run = null;
          time.goLive();
          time.setMotion('still');
          return false;
        }
        // Toward the moving "now", so Play lands on live exactly.
        time.stepTime(run.fromMs + (nowMs - run.fromMs) * progress);
        return true;
      }

      if (motion === 'reduced') {
        time.goLive();
        return false;
      }
      const next = returnStep(time.timeMs, nowMs, step);
      if (next.landed) {
        time.goLive();
        return false;
      }
      time.stepTime(next.timeMs);
      return true;
    },
  };
}

/** True when the store has just started an animation the driver must run. */
export function timeStarted(
  state: { readonly returning: boolean; readonly motion: string },
  previous: { readonly returning: boolean; readonly motion: string },
): boolean {
  return (
    (state.returning && !previous.returning) ||
    (state.motion === 'playing' && previous.motion !== 'playing')
  );
}

/**
 * Drives the time on requestAnimationFrame while the globe is not drawing
 * (the list, the flat map), and only while Play or a return runs.
 */
export function useTimeDriving(
  enabled: boolean,
  historyHours: number,
  motion: MotionPreference,
): void {
  useEffect(() => {
    if (!enabled) return;
    const driving = createTimeDriving(historyHours);
    let frame = 0;
    let lastMs: number | null = null;
    const onFrame = (timeMs: number): void => {
      const deltaSec = lastMs === null ? 0 : (timeMs - lastMs) / 1000;
      lastMs = timeMs;
      frame = driving.tick(deltaSec, motion) ? window.requestAnimationFrame(onFrame) : 0;
      if (frame === 0) lastMs = null;
    };
    const start = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(onFrame);
    };
    const time = timeStore.getState();
    if (time.motion === 'playing' || time.returning) start();
    const unsubscribe = timeStore.subscribe((state, previous) => {
      if (timeStarted(state, previous)) start();
    });
    return () => {
      unsubscribe();
      window.cancelAnimationFrame(frame);
    };
  }, [enabled, historyHours, motion]);
}
