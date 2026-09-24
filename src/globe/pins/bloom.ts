/**
 * The bloom's maths: a critically damped spring on each pin's path parameter,
 * the stagger between siblings, and the phyllotaxis layout of a stack's
 * petals. The vertex shader runs the same formulas; these are the CPU mirrors
 * the transition planner and the tests use.
 */

/**
 * Spring stiffness ω, 1/s. Critically damped from rest, the gap left after τ is
 *   (1 + ωτ) · e^(−ωτ)
 * which is 0.1 % at ωτ = 9.23: ω = 33 settles in 280 ms, never overshooting.
 */
export const BLOOM_OMEGA = 33;

/** Time for a spring started at rest to close all but 0.1 % of its path. */
export const BLOOM_SETTLE_SECONDS = 0.28;

/** The prompt's stagger between siblings, i · 18 ms, while it fits the budget. */
export const BLOOM_STEP_SECONDS = 0.018;

/**
 * The last sibling leaves by this long after the first, so a bloom of any size
 * ends within budget + settle = 580 ms of starting: the prompt's "under 600 ms
 * even for 100 children". Up to 17 siblings the step is exactly 18 ms.
 */
export const BLOOM_STAGGER_BUDGET_SECONDS = 0.3;

/** The golden angle, 137.507°: each petal turns this far from the one before. */
export const GOLDEN_ANGLE_RAD = (137.507 * Math.PI) / 180;

/** c in radius = c · √i, CSS pixels: dots about 14 px apart, a 120-story flower ~88 px across the radius. */
export const PETAL_SPACING_CSS_PX = 8;

/**
 * How far a path winds about its parent centre on the way out: at progress u
 * a pin is turned (1 − u) · twist from where it lands, so it spirals out
 * rather than sliding straight.
 */
export const BLOOM_TWIST_RAD = Math.PI / 3;

export interface SpringState {
  /** Path progress, 0 at the parent end, 1 at the child end. */
  u: number;
  /** du/dt, per second. */
  v: number;
}

/**
 * Critically damped spring from (u0, v0) at t0 toward `target`, evaluated at t:
 *   τ = max(0, t − t0),  Δ = u0 − target,  B = v0 + ωΔ
 *   u = target + (Δ + Bτ) · e^(−ωτ)
 *   v = (v0 − ωBτ) · e^(−ωτ)
 * Closed form in time, so it is frame-rate independent by construction. From
 * the settle time on it is exactly at the target: the 0.1 % left is invisible,
 * and a hidden slot resting at exactly 0 opacity is culled in the vertex
 * shader instead of rasterising a transparent quad.
 */
export function springAt(
  u0: number,
  v0: number,
  t0: number,
  target: number,
  t: number,
  out: SpringState = { u: 0, v: 0 },
): SpringState {
  const tau = Math.max(0, t - t0);
  if (tau >= BLOOM_SETTLE_SECONDS) {
    out.u = target;
    out.v = 0;
    return out;
  }
  const delta = u0 - target;
  const b = v0 + BLOOM_OMEGA * delta;
  const decay = Math.exp(-BLOOM_OMEGA * tau);
  out.u = Math.min(1, Math.max(0, target + (delta + b * tau) * decay));
  out.v = (v0 - BLOOM_OMEGA * b * tau) * decay;
  return out;
}

/** Seconds between siblings when `count` leave together. */
export function staggerStep(count: number): number {
  if (count <= 1) return 0;
  return Math.min(BLOOM_STEP_SECONDS, BLOOM_STAGGER_BUDGET_SECONDS / (count - 1));
}

/** Start delay of sibling `rank` of `count`: forwards on the way out, mirrored on the way back. */
export function staggerDelay(rank: number, count: number, reverse: boolean): number {
  return (reverse ? count - 1 - rank : rank) * staggerStep(count);
}

/** From the first sibling leaving to the last one settling. */
export function bloomSeconds(count: number): number {
  return Math.max(0, count - 1) * staggerStep(count) + BLOOM_SETTLE_SECONDS;
}

export interface Offset {
  x: number;
  y: number;
}

/**
 * Petal i of a sunflower (Vogel's model), CSS pixels, y up:
 *   angle = i · 137.507°,  radius = c · √i
 * Petal 0 sits on the centre, and equal areas hold equal numbers of petals.
 */
export function petalOffset(
  index: number,
  spacing: number = PETAL_SPACING_CSS_PX,
  out: Offset = { x: 0, y: 0 },
): Offset {
  const angle = index * GOLDEN_ANGLE_RAD;
  const radius = spacing * Math.sqrt(index);
  out.x = radius * Math.cos(angle);
  out.y = radius * Math.sin(angle);
  return out;
}
