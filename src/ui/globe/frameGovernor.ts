/**
 * Caps how often the globe draws (Prompt 4.5: "30fps" behind the discussion
 * panel). Frames still come from render-on-demand; a frame that is not yet
 * due is skipped and the next vsync asks again, so nothing waits longer than
 * one vsync past its due time.
 *
 * The schedule advances by the interval from the due time, not from the
 * draw: on a 144 Hz display a 30 fps cap lands every fourth or fifth vsync
 * and averages exactly 30. A small slack lets a vsync a hair early count, so
 * 60 Hz timestamps' jitter cannot turn every other frame into every third.
 */

export interface FrameGovernor {
  /** When the next draw is due, ms; 0 before the first. */
  nextDueMs: number;
}

/** Less than half a vsync even at 144 Hz (6.9 ms). */
export const DUE_SLACK_MS = 2;

export function createFrameGovernor(): FrameGovernor {
  return { nextDueMs: 0 };
}

/** Whether to draw at `nowMs` with at least `intervalMs` between draws (0 draws every frame). */
export function frameDue(governor: FrameGovernor, nowMs: number, intervalMs: number): boolean {
  if (intervalMs <= 0) {
    governor.nextDueMs = 0;
    return true;
  }
  if (nowMs < governor.nextDueMs - DUE_SLACK_MS) return false;
  // After an idle spell, start a fresh schedule rather than drawing a burst to catch up.
  governor.nextDueMs =
    nowMs - governor.nextDueMs > intervalMs ? nowMs + intervalMs : governor.nextDueMs + intervalMs;
  return true;
}

/** "30fps globe behind": the discussion's resting frame interval. */
export const REST_FRAME_INTERVAL_MS = 1000 / 30;
