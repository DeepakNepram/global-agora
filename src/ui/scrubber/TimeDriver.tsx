import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';

import type { MotionPreference } from '@/globe';
import { timeStore } from '@/state';

import { createTimeDriving, timeStarted } from './timeDriving';

/**
 * Runs before the scene's own frame callbacks (r3f calls lower priorities
 * first), so the frame it moves the time in also draws that time.
 */
const DRIVER_PRIORITY = -1;

export interface TimeDriverProps {
  readonly historyHours: number;
  /** Reduced motion lands a return at once; Play, which the viewer asked for, still plays. */
  readonly motion: MotionPreference;
}

/**
 * Moves the time store one frame at a time for Play and the return to live
 * (timeDriving.ts) while the globe draws. Render-nothing child of <Canvas>,
 * so it ticks on the frames r3f draws and asks for the next one only while
 * something moves. Without the globe, useTimeDriving runs the same step.
 */
export function TimeDriver({ historyHours, motion }: TimeDriverProps): null {
  const invalidate = useThree((state) => state.invalidate);
  const driving = useMemo(() => createTimeDriving(historyHours), [historyHours]);

  // Demand rendering draws nothing until asked: kick the first frame.
  useEffect(
    () =>
      timeStore.subscribe((state, previous) => {
        if (timeStarted(state, previous)) invalidate();
      }),
    [invalidate],
  );

  useFrame((_state, delta) => {
    if (driving.tick(delta, motion)) invalidate();
  }, DRIVER_PRIORITY);

  return null;
}
