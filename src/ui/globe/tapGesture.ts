/**
 * Tells a tap from a drag on the globe, from plain pointer data, so a native
 * host can reuse it. A tap is one pointer that goes down and up nearly in
 * place, quickly, while the globe was at rest: a press that stops a spinning
 * globe or a flight only stops it, as on every map.
 */

/** Matches the scrubber's drag slop: under this, a press has not moved. */
export const TAP_SLOP_CSS_PX = 6;

/** Longer than this is a press-and-hold, not a tap. */
export const TAP_MAX_MS = 600;

interface Press {
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
  readonly busy: boolean;
  moved: boolean;
}

export interface TapTracker {
  /** `busy`: the globe was spinning or flying when the pointer went down. */
  down(id: number, x: number, y: number, timeMs: number, busy: boolean): void;
  move(id: number, x: number, y: number): void;
  /** True when this release completes a tap. */
  up(id: number, x: number, y: number, timeMs: number): boolean;
  cancel(id: number): void;
}

export function createTapTracker(): TapTracker {
  const presses = new Map<number, Press>();
  // A second finger makes the whole gesture a pinch, until every finger lifts.
  let multi = false;

  const farFrom = (press: Press, x: number, y: number): boolean =>
    Math.hypot(x - press.x, y - press.y) > TAP_SLOP_CSS_PX;

  const release = (id: number): void => {
    presses.delete(id);
    if (presses.size === 0) multi = false;
  };

  return {
    down(id, x, y, timeMs, busy) {
      presses.set(id, { x, y, timeMs, busy, moved: false });
      if (presses.size > 1) multi = true;
    },

    move(id, x, y) {
      const press = presses.get(id);
      if (press && farFrom(press, x, y)) press.moved = true;
    },

    up(id, x, y, timeMs) {
      const press = presses.get(id);
      const wasMulti = multi;
      release(id);
      if (!press || wasMulti || press.busy || press.moved || farFrom(press, x, y)) return false;
      return timeMs - press.timeMs <= TAP_MAX_MS;
    },

    cancel(id) {
      release(id);
    },
  };
}
