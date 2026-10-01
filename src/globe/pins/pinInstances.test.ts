import { describe, expect, it } from 'vitest';

import { createNodeBuffer, fillMockNodes, type NodeBuffer } from '@/core';

import {
  LOOK,
  PIN_OFFSET,
  PIN_STRIDE,
  encodeLook,
  hiddenLook,
  isVisibleLook,
  lookKind,
  lookValue,
  rebaseClock,
  writeAppearance,
} from './pinInstances';
import { freshnessFor, pulsePhaseFor, pulseRateFor } from './pinStyle';

const WINDOW_END_MS = Date.UTC(2026, 8, 17, 12, 0, 0);
const NOW = WINDOW_END_MS / 1000;
/** The layer's time origin in these tests: an hour before the window ends. */
const ORIGIN = NOW - 3600;

function mockNodes(count = 3000): NodeBuffer {
  return fillMockNodes(createNodeBuffer(count), {
    count,
    windowEndMs: WINDOW_END_MS,
    windowHours: 24,
    seed: 7,
  });
}

/** Row i in slot i. */
function identitySlots(count: number): Int32Array {
  return Int32Array.from({ length: count }, (_, i) => i);
}

function read(array: Float32Array, slot: number, field: keyof typeof PIN_OFFSET): number {
  return array[slot * PIN_STRIDE + PIN_OFFSET[field]] ?? NaN;
}

/** sin(clock · rate + phase), as the vertex shader computes the pulse. */
function pulseWave(array: Float32Array, slot: number, clock: number): number {
  return Math.sin(clock * read(array, slot, 'rate') + read(array, slot, 'phase'));
}

describe('look', () => {
  it('packs kind, category and value into one exact float', () => {
    const look = encodeLook(LOOK.orb, 5, 3000);
    expect(Math.fround(look)).toBe(look);
    expect(lookKind(look)).toBe(LOOK.orb);
    expect(lookValue(look)).toBe(3000);
    expect(Math.floor(look / 4) % 8).toBe(5);
  });

  it('hides an end without changing what it would draw', () => {
    const pin = encodeLook(LOOK.pin, 2, 200);
    const orb = encodeLook(LOOK.orb, 2, 17);
    expect(lookKind(hiddenLook(pin))).toBe(LOOK.hiddenPin);
    expect(lookKind(hiddenLook(orb))).toBe(LOOK.hiddenOrb);
    expect(lookValue(hiddenLook(orb))).toBe(17);
    expect(hiddenLook(hiddenLook(pin))).toBe(hiddenLook(pin));
    expect([pin, orb].map(isVisibleLook)).toEqual([true, true]);
    expect([hiddenLook(pin), hiddenLook(orb)].map(isVisibleLook)).toEqual([false, false]);
  });

  it('maps a category the palette lacks to world', () => {
    expect(encodeLook(LOOK.pin, 42, 0)).toBe(encodeLook(LOOK.pin, 0, 0));
  });
});

describe('writeAppearance', () => {
  it('writes publish times from the origin and rates for the shown instant, and counts the published', () => {
    const nodes = mockNodes();
    const array = new Float32Array(nodes.count * PIN_STRIDE);
    const halfway = nodes.epochSec + 12 * 3600;
    const fresh = new Uint8Array(nodes.count).fill(1);
    const slots = identitySlots(nodes.count);
    const published = writeAppearance(nodes, slots, array, halfway, ORIGIN, 0, fresh);

    let expected = 0;
    for (let i = 0; i < nodes.count; i++) {
      const at = nodes.epochSec + (nodes.publishedSec[i] ?? 0);
      if (at <= halfway) expected++;
      // Whole seconds within a day of the origin: exact in float32.
      expect(read(array, i, 'published')).toBe(at - ORIGIN);
      expect(read(array, i, 'rate')).toBeCloseTo(pulseRateFor(freshnessFor(halfway - at)), 5);
      expect(read(array, i, 'phase')).toBeCloseTo(pulsePhaseFor(at), 5);
    }
    expect(published).toBe(expected);
    expect(published / nodes.count).toBeCloseTo(0.5, 1);
  });

  it('writes each row into the slot it was given, not its row', () => {
    const nodes = mockNodes(3);
    const array = new Float32Array(8 * PIN_STRIDE);
    writeAppearance(nodes, Int32Array.from([7, 2, 5]), array, NOW, ORIGIN, 0, null);
    expect(read(array, 7, 'rate')).toBeGreaterThan(0);
    expect(read(array, 0, 'rate')).toBe(0);
  });

  it('keeps every pulse continuous when the displayed time moves', () => {
    const nodes = mockNodes();
    const array = new Float32Array(nodes.count * PIN_STRIDE);
    const slots = identitySlots(nodes.count);
    const clock = 437.25;
    writeAppearance(
      nodes,
      slots,
      array,
      NOW - 6 * 3600,
      ORIGIN,
      clock,
      new Uint8Array(nodes.count).fill(1),
    );
    const before = Array.from({ length: nodes.count }, (_, i) => pulseWave(array, i, clock));
    const ratesBefore = Array.from({ length: nodes.count }, (_, i) => read(array, i, 'rate'));

    // A live sync (30 s) and a scrub (5 h) both change the rate of every pin on
    // the globe, so continuity here comes from the phase compensation.
    for (const now of [NOW - 6 * 3600 + 30, NOW - 3600]) {
      writeAppearance(nodes, slots, array, now, ORIGIN, clock, null);
      let changed = 0;
      for (let i = 0; i < nodes.count; i++) {
        if (read(array, i, 'rate') !== ratesBefore[i]) changed++;
        expect(Math.abs(pulseWave(array, i, clock) - (before[i] ?? NaN))).toBeLessThan(1e-5);
      }
      expect(changed).toBeGreaterThan(nodes.count / 4);
    }
  });
});

describe('rebaseClock', () => {
  it('rewinds the clock without moving any pulse or spring', () => {
    const nodes = mockNodes();
    const array = new Float32Array(nodes.count * PIN_STRIDE);
    writeAppearance(
      nodes,
      identitySlots(nodes.count),
      array,
      NOW,
      ORIGIN,
      0,
      new Uint8Array(nodes.count).fill(1),
    );
    const clock = 612.5;
    array[PIN_OFFSET.t0] = 612.4;
    const before = Array.from({ length: nodes.count }, (_, i) => pulseWave(array, i, clock));

    const rebased = rebaseClock(array, nodes.count, clock, clock);
    expect(rebased).toBe(0);
    expect(read(array, 0, 't0')).toBeCloseTo(-0.1, 4);
    for (let i = 0; i < nodes.count; i++) {
      expect(Math.abs(pulseWave(array, i, rebased) - (before[i] ?? NaN))).toBeLessThan(1e-5);
      expect(read(array, i, 'phase')).toBeGreaterThanOrEqual(0);
      expect(read(array, i, 'phase')).toBeLessThan(2 * Math.PI + 1e-6);
    }
  });

  it('floors long-settled start times so they stay precise', () => {
    const array = new Float32Array(PIN_STRIDE);
    array[PIN_OFFSET.t0] = -590;
    rebaseClock(array, 1, 600, 600);
    expect(read(array, 0, 't0')).toBe(-600);
  });
});
