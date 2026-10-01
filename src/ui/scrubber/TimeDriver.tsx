import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';

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

/**
 * Runs before the scene's own frame callbacks (r3f calls lower priorities
 * first), so the frame it moves the time in also draws that time.
 */
const DRIVER_PRIORITY = -1;

/** The first step after an idle spell: r3f's delta then spans the whole spell. */
const RESUME_STEP_SECONDS = 1 / 60;
/** A longer step is a backgrounded tab, not a frame. */
const MAX_STEP_SECONDS = 0.1;

interface PlayRun {
  readonly fromMs: number;
  readonly durationSec: number;
  elapsedSec: number;
}

export interface TimeDriverProps {
  readonly historyHours: number;
  /** Reduced motion lands a return at once; Play, which the viewer asked for, still plays. */
  readonly motion: MotionPreference;
}

/**
 * Moves the time store one frame at a time for the two animations the
 * scrubber asks for: Play (the whole window in about 20 s, along timeline.ts's
 * eased curve, ending live) and the eased return to live. Render-nothing child
 * of <Canvas>, so it ticks on the frames r3f draws and asks for the next one
 * only while something moves.
 */
export function TimeDriver({ historyHours, motion }: TimeDriverProps): null {
  const invalidate = useThree((state) => state.invalidate);
  const run = useRef<PlayRun | null>(null);
  const active = useRef(false);

  // Demand rendering draws nothing until asked: kick the first frame.
  useEffect(
    () =>
      timeStore.subscribe((state, previous) => {
        const started =
          (state.returning && !previous.returning) ||
          (state.motion === 'playing' && previous.motion !== 'playing');
        if (started) invalidate();
      }),
    [invalidate],
  );

  useFrame((_state, delta) => {
    const time = timeStore.getState();
    const playing = time.motion === 'playing';
    if (!playing) run.current = null;
    if (!playing && !time.returning) {
      active.current = false;
      return;
    }
    const step = active.current ? Math.min(delta, MAX_STEP_SECONDS) : RESUME_STEP_SECONDS;
    active.current = true;
    const nowMs = wallClockNow();

    if (playing) {
      if (!run.current) {
        const range = historyRange(nowMs, historyHours);
        const fromMs = playStartMs(time.timeMs, time.isLive, range);
        run.current = {
          fromMs,
          durationSec: playSeconds(fractionAt(fromMs, range)),
          elapsedSec: 0,
        };
        time.stepTime(fromMs);
        invalidate();
        return;
      }
      const current = run.current;
      current.elapsedSec += step;
      const progress = playProgress(current.elapsedSec, current.durationSec);
      if (progress >= 1) {
        run.current = null;
        time.goLive();
        time.setMotion('still');
        return;
      }
      // Toward the moving "now", so Play lands on live exactly.
      time.stepTime(current.fromMs + (nowMs - current.fromMs) * progress);
      invalidate();
      return;
    }

    if (motion === 'reduced') {
      time.goLive();
      return;
    }
    const next = returnStep(time.timeMs, nowMs, step);
    if (next.landed) {
      time.goLive();
      return;
    }
    time.stepTime(next.timeMs);
    invalidate();
  }, DRIVER_PRIORITY);

  return null;
}
