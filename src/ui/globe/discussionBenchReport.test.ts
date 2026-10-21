import { describe, expect, it } from 'vitest';

import { vsyncMs, windowStats } from './discussionBenchReport';

const VSYNC = 1000 / 60;
const ticks = (from: number, count: number, step = VSYNC): number[] =>
  Array.from({ length: count }, (_, i) => from + i * step);

describe('vsyncMs', () => {
  it('is the median gap between idle frames', () => {
    expect(vsyncMs(ticks(0, 30))).toBeCloseTo(VSYNC, 9);
    expect(vsyncMs(ticks(0, 30, 1000 / 144))).toBeCloseTo(1000 / 144, 9);
  });
});

describe('windowStats', () => {
  it('counts no missed frame in a steady 60 Hz window', () => {
    const all = ticks(0, 100);
    const stats = windowStats(
      all,
      { frames: all.map((atMs) => ({ atMs, cpuMs: 1 })), gpu: [] },
      200,
      800,
      VSYNC,
    );
    expect(stats.missed).toBe(0);
    expect(stats.intervalMaxMs).toBeCloseTo(VSYNC, 1);
    expect(stats.drawMeanMs).toBeCloseTo(VSYNC, 1);
  });

  it('counts a hitch, even on the window’s first frame', () => {
    const all = [...ticks(0, 12), 12 * VSYNC + 40, ...ticks(12 * VSYNC + 40 + VSYNC, 30)];
    const start = 12 * VSYNC + 40 - 1;
    const stats = windowStats(all, { frames: [], gpu: [] }, start, 2000, VSYNC);
    expect(stats.missed).toBe(1);
    expect(stats.intervalMaxMs).toBeCloseTo(40 + VSYNC, 1);
  });

  it('tells a missed 144 Hz vsync from a frame slower than 60 fps', () => {
    const fast = 1000 / 144;
    // A 14 ms frame misses a 144 Hz vsync but is inside 60 fps; a 20 ms one is not.
    const start = ticks(0, 10, fast);
    const late = (start.at(-1) ?? 0) + 14;
    const later = late + 20;
    const all = [...start, late, later, ...ticks(later + fast, 10, fast)];
    const stats = windowStats(all, { frames: [], gpu: [] }, 0, 1000, fast);
    expect(stats.missed).toBe(2);
    expect(stats.slowerThan60fps).toBe(1);
  });

  it('reads a 30 fps globe behind a 60 fps page', () => {
    const all = ticks(0, 120);
    const draws = all.filter((_, i) => i % 2 === 0).map((atMs) => ({ atMs, cpuMs: 1 }));
    const stats = windowStats(all, { frames: draws, gpu: [{ atMs: 500, ms: 2 }] }, 0, 2000, VSYNC);
    expect(stats.missed).toBe(0);
    expect(stats.drawMeanMs).toBeCloseTo(1000 / 30, 1);
    expect(stats.gpuP95Ms).toBe(2);
  });
});
