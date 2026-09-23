import { describe, expect, it } from 'vitest';

import { median, pairedSchedule, summarisePairs, type BenchRow } from './benchReport';

function row(pair: number, pins: number, intervalMeanMs: number, interrupted = false): BenchRow {
  return {
    pair,
    pins,
    buffer: '720×1025',
    interrupted,
    fps: 1000 / intervalMeanMs,
    intervalMeanMs,
    intervalP95Ms: null,
    cpuMeanMs: null,
    gpuMeanMs: null,
    gpuP95Ms: null,
  };
}

describe('pairedSchedule', () => {
  it('warms up with the load, then alternates which side of each pair runs first', () => {
    expect(pairedSchedule(3, 3000)).toEqual([
      { pair: -1, pins: 3000 },
      { pair: 0, pins: 0 },
      { pair: 0, pins: 3000 },
      { pair: 1, pins: 3000 },
      { pair: 1, pins: 0 },
      { pair: 2, pins: 0 },
      { pair: 2, pins: 3000 },
    ]);
  });
});

describe('median', () => {
  it('takes the middle value, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('summarisePairs', () => {
  it('reports medians of the baseline, the loaded runs and the per-pair cost', () => {
    const summary = summarisePairs([
      row(0, 0, 28),
      row(0, 3000, 32),
      row(1, 3000, 31),
      row(1, 0, 29),
      row(2, 0, 30),
      row(2, 3000, 35),
    ]);
    expect(summary.pairs).toBe(3);
    expect(summary.pinCostMs).toBe(4);
    expect(summary.baselineFps).toBeCloseTo(1000 / 29, 1);
    expect(summary.pinsFps).toBeCloseTo(1000 / 32, 1);
  });

  it('drops a whole pair when either of its runs was interrupted', () => {
    const summary = summarisePairs([
      row(0, 0, 28),
      row(0, 3000, 32),
      row(1, 3000, 1005, true),
      row(1, 0, 29),
    ]);
    expect(summary.pairs).toBe(1);
    expect(summary.pinCostMs).toBe(4);
  });

  it('is empty with no usable pairs', () => {
    expect(summarisePairs([row(0, 0, 28)])).toEqual({
      pairs: 0,
      baselineFps: null,
      pinsFps: null,
      pinCostMs: null,
    });
  });
});
