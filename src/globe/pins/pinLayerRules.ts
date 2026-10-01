import type { ClusterLayout } from '@/core';

/**
 * The pin layer's timing rules and the direction a layout change animates in,
 * kept apart from pinLayer.ts so that file stays about wiring.
 */

/** Enough for the 3000-story target, plus departures fading out, without growing. */
export const DEFAULT_CAPACITY = 4096;

/** A step longer than this is a resumed tab, not motion; see earth.ts. */
export const MAX_STEP_SECONDS = 0.25;

/**
 * The first step after the layer was idle. r3f's first delta after an idle
 * spell spans the whole spell, which would skip the start of a bloom; the
 * camera controls cap the same way (RESUME_STEP_SECONDS).
 */
export const RESUME_STEP_SECONDS = 1 / 60;

/**
 * Pulse rates follow the displayed time once it has rested this long. A scrub
 * moves only uNow; re-deriving every rate on the CPU each tick would cost a
 * pass and a buffer upload per frame for a frequency nobody can judge mid-drag.
 */
export const RETIME_REST_SECONDS = 0.25;

/**
 * Which way a change goes: clusters opening as the time starts to move bloom
 * out like a zoom in, and close like a zoom out; otherwise the level decides.
 */
export function directionOf(
  previousLevel: number | null,
  wasOpen: boolean,
  layout: ClusterLayout,
): number {
  if (previousLevel === null) return 0;
  if (layout.open !== wasOpen) return layout.open ? 1 : -1;
  return Math.sign(layout.level - previousLevel);
}
