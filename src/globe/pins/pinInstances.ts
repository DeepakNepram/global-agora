import { NEWS_CATEGORIES, type NodeBuffer } from '@/core';

import {
  CATEGORY_COLORS,
  colorGainFor,
  hotFor,
  pulsePhaseFor,
  pulseRateFor,
  recencyFor,
  scaleForHeat,
} from './pinStyle';

/**
 * Per-instance layout of the pins' one interleaved buffer: twelve floats, a
 * round 48 bytes per pin.
 */
export const PIN_STRIDE = 12;

export const PIN_OFFSET = {
  center: 0,
  color: 3,
  scale: 6,
  alpha: 7,
  phase: 8,
  rate: 9,
  recency: 10,
  hot: 11,
} as const;

const TAU = Math.PI * 2;

/**
 * 'replace': the rows are new data; phases start from each publish time.
 * 'retime': the same rows at a new instant. Rates change with recency, so each
 * phase absorbs clock · (oldRate - newRate) and sin(clock·rate + phase) is
 * unchanged at this clock: the pulse carries on instead of jumping.
 */
export type InstanceWrite = 'replace' | 'retime';

function wrapAngle(angle: number): number {
  return angle - TAU * Math.floor(angle / TAU);
}

/**
 * Writes every live node into `array` in one pass and returns how many pins are
 * visible at `nowSeconds` (published at or before it). Reads nothing but typed
 * arrays and allocates nothing, so it can run on every scrubber tick.
 */
export function writeInstances(
  nodes: NodeBuffer,
  array: Float32Array,
  nowSeconds: number,
  clockSeconds: number,
  mode: InstanceWrite,
): number {
  const { count, epochSec, positions, publishedSec, categories, heat } = nodes;
  if (array.length < count * PIN_STRIDE) {
    throw new RangeError(`instance array holds ${array.length / PIN_STRIDE} pins, need ${count}`);
  }

  let visible = 0;
  for (let i = 0; i < count; i++) {
    const row = i * PIN_STRIDE;
    const published = epochSec + (publishedSec[i] ?? 0);
    const age = nowSeconds - published;
    const recency = recencyFor(age);
    // Rounded as the array will store it, so a later retime subtracts exactly
    // the rate the GPU has been using.
    const rate = Math.fround(pulseRateFor(recency));
    const gain = colorGainFor(recency);
    const category = categories[i] ?? 0;
    const hue = (category < NEWS_CATEGORIES.length ? category : 0) * 3;

    array[row + PIN_OFFSET.center] = positions[i * 3] ?? 0;
    array[row + PIN_OFFSET.center + 1] = positions[i * 3 + 1] ?? 0;
    array[row + PIN_OFFSET.center + 2] = positions[i * 3 + 2] ?? 0;
    array[row + PIN_OFFSET.color] = (CATEGORY_COLORS[hue] ?? 0) * gain;
    array[row + PIN_OFFSET.color + 1] = (CATEGORY_COLORS[hue + 1] ?? 0) * gain;
    array[row + PIN_OFFSET.color + 2] = (CATEGORY_COLORS[hue + 2] ?? 0) * gain;
    array[row + PIN_OFFSET.scale] = scaleForHeat(heat[i] ?? 0);

    // Not yet published at the displayed instant: the story is not on the globe.
    const shown = age >= 0;
    array[row + PIN_OFFSET.alpha] = shown ? 1 : 0;
    if (shown) visible++;

    const previousRate = array[row + PIN_OFFSET.rate] ?? rate;
    const previousPhase = array[row + PIN_OFFSET.phase] ?? 0;
    array[row + PIN_OFFSET.phase] =
      mode === 'retime'
        ? wrapAngle(previousPhase + clockSeconds * (previousRate - rate))
        : pulsePhaseFor(published);
    array[row + PIN_OFFSET.rate] = rate;
    array[row + PIN_OFFSET.recency] = recency;
    array[row + PIN_OFFSET.hot] = hotFor(recency);
  }
  return visible;
}

/**
 * Moves the pulse clock back by `bySeconds` without moving any pulse:
 * sin((clock - by)·rate + phase + by·rate) = sin(clock·rate + phase).
 * Returns the new clock.
 */
export function rebasePulseClock(
  array: Float32Array,
  count: number,
  clockSeconds: number,
  bySeconds: number,
): number {
  for (let i = 0; i < count; i++) {
    const row = i * PIN_STRIDE;
    const rate = array[row + PIN_OFFSET.rate] ?? 0;
    const phase = array[row + PIN_OFFSET.phase] ?? 0;
    array[row + PIN_OFFSET.phase] = wrapAngle(phase + bySeconds * rate);
  }
  return clockSeconds - bySeconds;
}
