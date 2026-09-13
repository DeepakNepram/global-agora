/**
 * Turns raw pointer events into drag, pinch and release callbacks.
 *
 * Input is plain data (canvas-relative CSS pixels plus the event's own
 * timestamp), so this file knows nothing about the DOM: a native host feeds it
 * touches the same way src/ui feeds it PointerEvents.
 */

import { createVelocityTracker, type ScreenVelocity } from './inertia';

export interface PointerInput {
  readonly id: number;
  /** CSS pixels from the canvas's left edge. */
  readonly x: number;
  /** CSS pixels from the canvas's top edge. */
  readonly y: number;
  /** Event timestamp in ms on a monotonic clock (DOM: event.timeStamp). */
  readonly timeMs: number;
}

export interface GestureHandlers {
  /** The first pointer went down. */
  onGrab(): void;
  /** One pointer moved, by this many pixels. */
  onDrag(dxPx: number, dyPx: number): void;
  /** Two pointers are down; the pinch is measured from here. */
  onPinchStart(midX: number, midY: number): void;
  /** `spread` is the start distance over the current distance: > 1 when pinching in. */
  onPinch(midX: number, midY: number, spread: number): void;
  /** The last pointer lifted. Velocity is pixels per second, zero unless it was a flick. */
  onRelease(velocityPxPerSecond: ScreenVelocity): void;
}

export interface PointerGestures {
  readonly pointerCount: number;
  down(input: PointerInput): void;
  move(input: PointerInput): void;
  /** `cancelled` (pointercancel, lost capture) releases without a flick. */
  up(input: PointerInput, cancelled: boolean): void;
  reset(): void;
}

interface Tracked {
  x: number;
  y: number;
}

export function createPointerGestures(handlers: GestureHandlers): PointerGestures {
  const pointers = new Map<number, Tracked>();
  const tracker = createVelocityTracker();
  const release: ScreenVelocity = { x: 0, y: 0 };
  let pinchStartDistance = 1;

  const pair = (): [Tracked, Tracked] | null => {
    const [a, b] = pointers.values();
    return a && b ? [a, b] : null;
  };

  const startPinch = (): void => {
    const both = pair();
    if (!both) return;
    const [a, b] = both;
    pinchStartDistance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    handlers.onPinchStart((a.x + b.x) / 2, (a.y + b.y) / 2);
  };

  return {
    get pointerCount() {
      return pointers.size;
    },

    down(input) {
      if (pointers.has(input.id)) return;
      pointers.set(input.id, { x: input.x, y: input.y });
      if (pointers.size === 1) {
        handlers.onGrab();
        tracker.reset(input.timeMs, input.x, input.y);
      } else if (pointers.size === 2) {
        startPinch();
      }
    },

    move(input) {
      const tracked = pointers.get(input.id);
      if (!tracked) return;
      const dx = input.x - tracked.x;
      const dy = input.y - tracked.y;
      tracked.x = input.x;
      tracked.y = input.y;

      if (pointers.size === 1) {
        handlers.onDrag(dx, dy);
        tracker.add(input.timeMs, input.x, input.y);
        return;
      }
      const both = pair();
      if (!both) return;
      const [a, b] = both;
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      handlers.onPinch((a.x + b.x) / 2, (a.y + b.y) / 2, pinchStartDistance / distance);
    },

    up(input, cancelled) {
      if (!pointers.delete(input.id)) return;
      if (pointers.size >= 2) {
        startPinch();
      } else if (pointers.size === 1) {
        // Back to a one-finger drag. Its flick is measured from here only, so
        // lifting both fingers together does not fling the globe.
        const [remaining] = pointers.values();
        if (remaining) tracker.reset(input.timeMs, remaining.x, remaining.y);
      } else if (cancelled) {
        release.x = 0;
        release.y = 0;
        handlers.onRelease(release);
      } else {
        handlers.onRelease(tracker.release(input.timeMs, release));
      }
    },

    reset() {
      pointers.clear();
    },
  };
}
