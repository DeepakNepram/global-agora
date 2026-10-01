import { NEWS_CATEGORIES, type NodeBuffer } from '@/core';

import { freshnessFor, pulsePhaseFor, pulseRateFor } from './pinStyle';

/**
 * Per-slot layout of the pins' one interleaved buffer: twenty floats, five
 * vec4 attributes, 80 bytes. A slot belongs to one story (keyed by story id,
 * see pinSlots.ts) and draws it as a pin, as its cluster's orb, or nothing.
 *
 * Each slot holds a path between two ends, inner (the parent side: a cluster
 * centre) and outer (the child side), and a spring that moves it along that
 * path. The vertex shader evaluates both, so a bloom costs the CPU nothing per
 * frame.
 */
export const PIN_STRIDE = 20;

export const PIN_OFFSET = {
  /** Inner end: unit-sphere anchor xyz, then its look. */
  inner: 0,
  innerLook: 3,
  /** Outer end: unit-sphere anchor xyz, then its look. */
  outer: 4,
  outerLook: 7,
  /** Screen offsets at each end, CSS px, y up: petal positions. */
  innerPx: 8,
  outerPx: 10,
  /** The spring: progress and velocity at t0, the clock time it starts, and its target (0 or 1). */
  u0: 12,
  v0: 13,
  t0: 14,
  target: 15,
  /**
   * The story's pulse, its publish time (seconds after the layer's time
   * origin: the shader ages it against uNow), and the path's twist.
   */
  phase: 16,
  rate: 17,
  published: 18,
  twist: 19,
} as const;

/** What an end draws. Hidden ends keep the kind they fade from, so they shrink the right shape. */
export const LOOK = {
  hiddenPin: 0,
  pin: 1,
  orb: 2,
  hiddenOrb: 3,
} as const;

export type LookKind = (typeof LOOK)[keyof typeof LOOK];

/**
 * One exact float per end (integers below 2^24 survive float32):
 *   look = kind + 4 · category + 32 · value
 * where value is the story's heat (0–255) for a pin and the member count for
 * an orb.
 */
export function encodeLook(kind: LookKind, category: number, value: number): number {
  const safeCategory = category >= 0 && category < NEWS_CATEGORIES.length ? category : 0;
  return kind + 4 * safeCategory + 32 * Math.max(0, Math.min(Math.round(value), 0xffff));
}

export function lookKind(look: number): LookKind {
  return (look % 4) as LookKind;
}

export function lookValue(look: number): number {
  return Math.floor(look / 32);
}

export function isVisibleLook(look: number): boolean {
  const kind = lookKind(look);
  return kind === LOOK.pin || kind === LOOK.orb;
}

/** The same end, not drawn: what a pin or orb shrinks into and grows out of. */
export function hiddenLook(look: number): number {
  const kind = lookKind(look);
  if (kind === LOOK.pin) return look - LOOK.pin + LOOK.hiddenPin;
  if (kind === LOOK.orb) return look - LOOK.orb + LOOK.hiddenOrb;
  return look;
}

/** Far past any spring's settling time; see rebaseClock. */
const SETTLED_T0_FLOOR_SECONDS = 600;

function wrapAngle(angle: number): number {
  const tau = Math.PI * 2;
  return angle - tau * Math.floor(angle / tau);
}

/**
 * Writes every live row's publish time and pulse into its slot and returns how
 * many stories are published at `nowSeconds`. Publish times are seconds after
 * `originSeconds`, the layer's fixed time origin, so they stay exact in
 * float32. A slot flagged in `fresh` holds a new story, whose pulse starts
 * from its publish time; every other slot keeps its pulse going: its phase
 * absorbs clock · (oldRate − newRate), so sin(clock · rate + phase) does not
 * jump when freshness changes the rate. Allocates nothing.
 */
export function writeAppearance(
  nodes: NodeBuffer,
  rowSlots: Int32Array,
  array: Float32Array,
  nowSeconds: number,
  originSeconds: number,
  clockSeconds: number,
  fresh: Uint8Array | null,
): number {
  const { count, epochSec, publishedSec } = nodes;
  let published = 0;
  for (let row = 0; row < count; row++) {
    const slot = rowSlots[row] ?? -1;
    if (slot < 0) continue;
    const at = slot * PIN_STRIDE;
    const publishedAt = epochSec + (publishedSec[row] ?? 0);
    const age = nowSeconds - publishedAt;
    // Rounded as the array will store it, so a later retime subtracts exactly
    // the rate the GPU has been using.
    const rate = Math.fround(pulseRateFor(freshnessFor(age)));
    if (age >= 0) published++;

    if (fresh?.[slot]) {
      array[at + PIN_OFFSET.phase] = pulsePhaseFor(publishedAt);
    } else {
      const previousRate = array[at + PIN_OFFSET.rate] ?? rate;
      const previousPhase = array[at + PIN_OFFSET.phase] ?? 0;
      array[at + PIN_OFFSET.phase] = wrapAngle(
        previousPhase + clockSeconds * (previousRate - rate),
      );
    }
    array[at + PIN_OFFSET.rate] = rate;
    array[at + PIN_OFFSET.published] = publishedAt - originSeconds;
  }
  return published;
}

/**
 * Moves the clock back by `bySeconds` without moving anything drawn: every
 * pulse keeps sin((clock − by)·rate + phase + by·rate), and every spring its
 * start time t0 − by. Returns the new clock.
 */
export function rebaseClock(
  array: Float32Array,
  slots: number,
  clockSeconds: number,
  bySeconds: number,
): number {
  for (let slot = 0; slot < slots; slot++) {
    const at = slot * PIN_STRIDE;
    const rate = array[at + PIN_OFFSET.rate] ?? 0;
    const phase = array[at + PIN_OFFSET.phase] ?? 0;
    array[at + PIN_OFFSET.phase] = wrapAngle(phase + bySeconds * rate);
    // A spring that started this long ago has settled, and stays settled at
    // any older start; the floor keeps t0 where float32 is still fine-grained.
    const t0 = (array[at + PIN_OFFSET.t0] ?? 0) - bySeconds;
    array[at + PIN_OFFSET.t0] = Math.max(t0, -SETTLED_T0_FLOOR_SECONDS);
  }
  return clockSeconds - bySeconds;
}

/** Lands the first `slots` springs where they are heading, at `clockSeconds`. */
export function landSprings(array: Float32Array, slots: number, clockSeconds: number): void {
  for (let slot = 0; slot < slots; slot++) {
    const at = slot * PIN_STRIDE;
    array[at + PIN_OFFSET.u0] = array[at + PIN_OFFSET.target] ?? 1;
    array[at + PIN_OFFSET.v0] = 0;
    array[at + PIN_OFFSET.t0] = clockSeconds;
  }
}
