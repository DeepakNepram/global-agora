/**
 * Flick inertia, in screen heights per second.
 *
 * Velocity lives in screen space and is converted to radians at the current
 * altitude each step. The stop threshold and the flick cap then mean the same
 * thing at every altitude, and a zoom during a spin keeps the spin's on-screen
 * speed instead of its angular speed.
 */

/** A hard flick: roughly a fast swipe across a phone screen. */
export const HARD_FLICK_SPEED = 4;

/** Below this the motion is ~14px/s on a 700px viewport: indistinguishable from stopped. */
export const STOP_SPEED = 0.02;

export const HARD_FLICK_SPIN_SECONDS = 2.5;

/**
 * Decay rate, 1/s. With v(t) = v0 e^(-f t), the time to fall from v0 to the
 * stop threshold is ln(v0 / STOP) / f; solved for a hard flick lasting 2.5 s:
 *
 *   f = ln(HARD_FLICK_SPEED / STOP_SPEED) / HARD_FLICK_SPIN_SECONDS  ~ 2.12
 */
export const FRICTION = Math.log(HARD_FLICK_SPEED / STOP_SPEED) / HARD_FLICK_SPIN_SECONDS;

/** Caps a mis-measured release (one 2ms sample) so it cannot spin for a minute. */
export const MAX_FLICK_SPEED = 8;

/** Release velocity is measured over this much of the drag's tail. */
export const VELOCITY_WINDOW_MS = 80;

/** A pointer that rested this long before lifting was placed, not flicked. */
export const RELEASE_STALE_MS = 50;

/** Shorter spans are too noisy to measure a velocity from. */
const MIN_SPAN_MS = 8;

const CAPACITY = 16;

export interface ScreenVelocity {
  /** Screen heights per second. */
  x: number;
  y: number;
}

export interface DecayStep {
  /** Screen heights travelled during the step. */
  readonly dx: number;
  readonly dy: number;
}

/**
 * Advances inertia by dt, mutating `velocity`.
 *
 *   v(t + dt) = v e^(-f dt)
 *   travel    = integral of v over the step = v (1 - e^(-f dt)) / f
 *
 * Moving by the exact integral rather than v * dt makes the total spin
 * identical at 30, 60 and 144 fps, not merely close.
 */
export function decayVelocity(
  velocity: ScreenVelocity,
  dt: number,
  friction = FRICTION,
): DecayStep {
  const decay = Math.exp(-friction * dt);
  const travel = (1 - decay) / friction;
  const step = { dx: velocity.x * travel, dy: velocity.y * travel };
  velocity.x *= decay;
  velocity.y *= decay;
  if (Math.hypot(velocity.x, velocity.y) < STOP_SPEED) {
    velocity.x = 0;
    velocity.y = 0;
  }
  return step;
}

export interface VelocityTracker {
  reset(timeMs: number, x: number, y: number): void;
  add(timeMs: number, x: number, y: number): void;
  /** Release velocity in pixels per second; zero if the pointer had come to rest. */
  release(timeMs: number, target: ScreenVelocity): ScreenVelocity;
}

/** Fixed ring of recent pointer positions, allocated once per controls instance. */
export function createVelocityTracker(): VelocityTracker {
  const times = new Float64Array(CAPACITY);
  const xs = new Float64Array(CAPACITY);
  const ys = new Float64Array(CAPACITY);
  let head = 0;
  let count = 0;

  const push = (timeMs: number, x: number, y: number): void => {
    head = (head + 1) % CAPACITY;
    times[head] = timeMs;
    xs[head] = x;
    ys[head] = y;
    count = Math.min(count + 1, CAPACITY);
  };

  return {
    reset(timeMs, x, y) {
      count = 0;
      push(timeMs, x, y);
    },

    add: push,

    release(timeMs, target) {
      target.x = 0;
      target.y = 0;
      if (count < 2 || timeMs - (times[head] ?? 0) > RELEASE_STALE_MS) return target;

      const newest = times[head] ?? 0;
      let oldest = head;
      for (let i = 1; i < count; i++) {
        const index = (head - i + CAPACITY) % CAPACITY;
        if (newest - (times[index] ?? 0) > VELOCITY_WINDOW_MS) break;
        oldest = index;
      }
      const span = newest - (times[oldest] ?? 0);
      if (span < MIN_SPAN_MS) return target;

      target.x = (((xs[head] ?? 0) - (xs[oldest] ?? 0)) / span) * 1000;
      target.y = (((ys[head] ?? 0) - (ys[oldest] ?? 0)) / span) * 1000;
      return target;
    },
  };
}

/** Scales a velocity down to `max` without changing its direction. */
export function capSpeed(velocity: ScreenVelocity, max: number = MAX_FLICK_SPEED): ScreenVelocity {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed > max) {
    velocity.x *= max / speed;
    velocity.y *= max / speed;
  }
  return velocity;
}
