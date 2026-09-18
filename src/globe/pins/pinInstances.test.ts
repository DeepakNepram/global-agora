import { describe, expect, it } from 'vitest';

import { createNodeBuffer, fillMockNodes, type NodeBuffer } from '@/core';

import { PIN_OFFSET, PIN_STRIDE, rebasePulseClock, writeInstances } from './pinInstances';
import { CATEGORY_COLORS, colorGainFor, hotFor, recencyFor, scaleForHeat } from './pinStyle';

const WINDOW_END_MS = Date.UTC(2026, 8, 17, 12, 0, 0);
const NOW = WINDOW_END_MS / 1000;

function mockNodes(count = 3000): NodeBuffer {
  return fillMockNodes(createNodeBuffer(count), {
    count,
    windowEndMs: WINDOW_END_MS,
    windowHours: 24,
    seed: 7,
  });
}

function read(array: Float32Array, pin: number, field: keyof typeof PIN_OFFSET): number {
  return array[pin * PIN_STRIDE + PIN_OFFSET[field]] ?? NaN;
}

/**
 * Where a pin is in its pulse cycle: sin(clock · rate + phase), as the vertex
 * shader computes it. Its amplitude (recency) may change with time; this must not.
 */
function pulseWave(array: Float32Array, pin: number, clock: number): number {
  return Math.sin(clock * read(array, pin, 'rate') + read(array, pin, 'phase'));
}

describe('writeInstances', () => {
  it('writes each node into its row at the published offsets', () => {
    const nodes = mockNodes(10);
    const array = new Float32Array(10 * PIN_STRIDE);
    writeInstances(nodes, array, NOW, 0, 'replace');

    for (let i = 0; i < nodes.count; i++) {
      expect(read(array, i, 'center')).toBeCloseTo(nodes.positions[i * 3] ?? NaN, 6);
      expect(array[i * PIN_STRIDE + PIN_OFFSET.center + 2]).toBeCloseTo(
        nodes.positions[i * 3 + 2] ?? NaN,
        6,
      );
      const age = NOW - (nodes.epochSec + (nodes.publishedSec[i] ?? 0));
      const recency = recencyFor(age);
      expect(read(array, i, 'recency')).toBeCloseTo(recency, 6);
      const hue = (nodes.categories[i] ?? 0) * 3;
      expect(read(array, i, 'color')).toBeCloseTo(
        (CATEGORY_COLORS[hue] ?? NaN) * colorGainFor(recency),
        5,
      );
      expect(read(array, i, 'scale')).toBeCloseTo(scaleForHeat(nodes.heat[i] ?? 0), 6);
      expect(read(array, i, 'hot')).toBeCloseTo(hotFor(recency), 6);
      expect(read(array, i, 'alpha')).toBe(1);
    }
  });

  it('hides stories not yet published at the displayed time and counts the rest', () => {
    const nodes = mockNodes();
    const array = new Float32Array(nodes.count * PIN_STRIDE);
    const halfway = nodes.epochSec + 12 * 3600;
    const visible = writeInstances(nodes, array, halfway, 0, 'replace');

    let expected = 0;
    for (let i = 0; i < nodes.count; i++) {
      const published = nodes.epochSec + (nodes.publishedSec[i] ?? 0);
      expect(read(array, i, 'alpha')).toBe(published <= halfway ? 1 : 0);
      if (published <= halfway) expected++;
    }
    expect(visible).toBe(expected);
    expect(visible / nodes.count).toBeCloseTo(0.5, 1);
  });

  it('rejects an array too small for the live rows', () => {
    expect(() =>
      writeInstances(mockNodes(10), new Float32Array(9 * PIN_STRIDE), NOW, 0, 'replace'),
    ).toThrow(RangeError);
  });

  it('keeps every pulse continuous when the displayed time moves', () => {
    const nodes = mockNodes();
    const array = new Float32Array(nodes.count * PIN_STRIDE);
    const clock = 437.25;
    writeInstances(nodes, array, NOW - 6 * 3600, clock, 'replace');
    const before = Array.from({ length: nodes.count }, (_, i) => pulseWave(array, i, clock));
    const ratesBefore = Array.from({ length: nodes.count }, (_, i) => read(array, i, 'rate'));

    // A live sync (30 s) and a scrub (5 h) both change the rate of every pin on
    // the globe, so continuity here comes from the phase compensation.
    for (const now of [NOW - 6 * 3600 + 30, NOW - 3600]) {
      writeInstances(nodes, array, now, clock, 'retime');
      let changed = 0;
      for (let i = 0; i < nodes.count; i++) {
        if (read(array, i, 'alpha') === 0) continue;
        if (read(array, i, 'rate') !== ratesBefore[i]) changed++;
        expect(Math.abs(pulseWave(array, i, clock) - (before[i] ?? NaN))).toBeLessThan(1e-5);
      }
      expect(changed).toBeGreaterThan(nodes.count / 4);
    }
  });
});

describe('rebasePulseClock', () => {
  it('rewinds the clock without moving any pulse', () => {
    const nodes = mockNodes();
    const array = new Float32Array(nodes.count * PIN_STRIDE);
    writeInstances(nodes, array, NOW, 0, 'replace');
    const clock = 612.5;
    const before = Array.from({ length: nodes.count }, (_, i) => pulseWave(array, i, clock));

    const rebased = rebasePulseClock(array, nodes.count, clock, clock);
    expect(rebased).toBe(0);
    for (let i = 0; i < nodes.count; i++) {
      expect(Math.abs(pulseWave(array, i, rebased) - (before[i] ?? NaN))).toBeLessThan(1e-5);
      expect(read(array, i, 'phase')).toBeGreaterThanOrEqual(0);
      expect(read(array, i, 'phase')).toBeLessThan(2 * Math.PI + 1e-6);
    }
  });
});
