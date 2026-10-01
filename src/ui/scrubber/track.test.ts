import { describe, expect, it } from 'vitest';

import { barHeights, tickHours } from './track';

describe('tickHours', () => {
  it('labels about four intervals, oldest first, whatever the window', () => {
    expect(tickHours(24)).toEqual([18, 12, 6]);
    expect(tickHours(48)).toEqual([36, 24, 12]);
    expect(tickHours(6)).toEqual([4, 2]);
    expect(tickHours(72)).toEqual([48, 24]);
    expect(tickHours(1)).toEqual([]);
  });
});

describe('barHeights', () => {
  it('scales by the square root of the busiest bucket and keeps quiet buckets visible', () => {
    const heights = barHeights(Uint16Array.from([0, 1, 25, 100]));
    expect(heights[0]).toBe(0);
    expect(heights[1]).toBeCloseTo(0.1, 6);
    expect(heights[2]).toBeCloseTo(0.5, 6);
    expect(heights[3]).toBe(1);
    expect(barHeights(Uint16Array.from([1, 10_000]))[0]).toBeCloseTo(0.06, 6);
  });

  it('draws nothing for an empty window', () => {
    expect(Array.from(barHeights(new Uint16Array(4)))).toEqual([0, 0, 0, 0]);
  });
});
