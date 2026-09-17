import { describe, expect, it } from 'vitest';

import { fillMockNodes } from './mockNodes';
import { createNodeBuffer, NEWS_CATEGORIES, nodeBufferCapacity } from './nodeBuffer';

const WINDOW_END_MS = Date.UTC(2026, 8, 17, 12, 0, 0);
const OPTIONS = { count: 3000, windowEndMs: WINDOW_END_MS, windowHours: 24, seed: 1 } as const;

describe('createNodeBuffer', () => {
  it('sizes every column by capacity and starts empty', () => {
    const buffer = createNodeBuffer(10);
    expect(nodeBufferCapacity(buffer)).toBe(10);
    expect(buffer.count).toBe(0);
    expect(buffer.positions).toHaveLength(30);
    expect(buffer.publishedSec).toHaveLength(10);
    expect(buffer.categories).toHaveLength(10);
  });

  it('rejects a non-integer or negative capacity', () => {
    expect(() => createNodeBuffer(-1)).toThrow(RangeError);
    expect(() => createNodeBuffer(1.5)).toThrow(RangeError);
  });
});

describe('fillMockNodes', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = fillMockNodes(createNodeBuffer(3000), OPTIONS);
    const b = fillMockNodes(createNodeBuffer(3000), OPTIONS);
    const c = fillMockNodes(createNodeBuffer(3000), { ...OPTIONS, seed: 2 });
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.publishedSec)).toEqual(Array.from(b.publishedSec));
    expect(Array.from(a.positions)).not.toEqual(Array.from(c.positions));
  });

  it('writes into the buffer it was given', () => {
    const buffer = createNodeBuffer(3000);
    expect(fillMockNodes(buffer, OPTIONS)).toBe(buffer);
    expect(buffer.count).toBe(3000);
  });

  it('puts every node on the unit sphere, spread evenly by area', () => {
    const { positions, count } = fillMockNodes(createNodeBuffer(3000), OPTIONS);
    let north = 0;
    let polarCap = 0;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3] ?? NaN;
      const y = positions[i * 3 + 1] ?? NaN;
      const z = positions[i * 3 + 2] ?? NaN;
      expect(Math.abs(Math.hypot(x, y, z) - 1)).toBeLessThan(1e-6);
      if (y > 0) north++;
      // Beyond ±60° latitude is 1 - sin 60° = 13.4% of the sphere's area.
      if (Math.abs(y) > Math.sin(Math.PI / 3)) polarCap++;
    }
    expect(north / count).toBeCloseTo(0.5, 1);
    expect(polarCap / count).toBeGreaterThan(0.1);
    expect(polarCap / count).toBeLessThan(0.17);
  });

  it('places the window from its end and length, and every time inside it', () => {
    const buffer = fillMockNodes(createNodeBuffer(3000), { ...OPTIONS, windowHours: 168 });
    expect(buffer.epochSec).toBe(WINDOW_END_MS / 1000 - 168 * 3600);
    let latest = 0;
    for (let i = 0; i < buffer.count; i++) {
      const t = buffer.publishedSec[i] ?? -1;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(168 * 3600);
      latest = Math.max(latest, t);
    }
    expect(latest).toBeGreaterThan(160 * 3600);
  });

  it('uses every category and skews heat low', () => {
    const { categories, heat, count } = fillMockNodes(createNodeBuffer(3000), OPTIONS);
    const seen = new Set(categories.subarray(0, count));
    expect([...seen].sort()).toEqual(NEWS_CATEGORIES.map((_, i) => i));
    const sorted = Array.from(heat.subarray(0, count)).sort((a, b) => a - b);
    // Median of 255·u³ is 255/8.
    expect(sorted[count / 2]).toBeLessThan(45);
    expect(sorted[count - 1]).toBeGreaterThan(240);
  });

  it('rejects a count over capacity and an empty window', () => {
    expect(() => fillMockNodes(createNodeBuffer(10), OPTIONS)).toThrow(RangeError);
    expect(() => fillMockNodes(createNodeBuffer(3000), { ...OPTIONS, windowHours: 0 })).toThrow(
      RangeError,
    );
  });
});
