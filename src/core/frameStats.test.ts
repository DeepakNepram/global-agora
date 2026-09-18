import { describe, expect, it } from 'vitest';

import { createFrameStats, percentile } from './frameStats';

describe('percentile', () => {
  it('uses nearest rank', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(19);
    expect(percentile(values, 50)).toBe(10);
    expect(percentile(values, 100)).toBe(20);
    expect(percentile(values, 0)).toBe(1);
  });

  it('does not depend on input order and does not mutate it', () => {
    const values = [5, 1, 4, 2, 3];
    expect(percentile(values, 60)).toBe(3);
    expect(values).toEqual([5, 1, 4, 2, 3]);
  });

  it('is null for no samples', () => {
    expect(percentile([], 95)).toBeNull();
  });
});

describe('createFrameStats', () => {
  it('summarises CPU and GPU streams independently', () => {
    const stats = createFrameStats(10);
    stats.recordCpu(100, 1);
    stats.recordCpu(110, 3);
    stats.recordGpu(4);
    const s = stats.summary(120);
    expect(s.frames).toBe(2);
    expect(s.cpuMeanMs).toBe(2);
    expect(s.cpuP95Ms).toBe(3);
    expect(s.gpuFrames).toBe(1);
    expect(s.gpuMeanMs).toBe(4);
  });

  it('reports null GPU figures when no query ever resolved', () => {
    const stats = createFrameStats(4);
    stats.recordCpu(0, 1);
    expect(stats.summary(0)).toMatchObject({ gpuFrames: 0, gpuMeanMs: null, gpuP95Ms: null });
  });

  it('keeps only the newest `capacity` samples', () => {
    const stats = createFrameStats(3);
    for (const [i, ms] of [100, 100, 1, 2, 3].entries()) stats.recordCpu(i, ms);
    expect(stats.summary(10)).toMatchObject({ frames: 3, cpuMeanMs: 2 });
  });

  it('counts frames in the last second, so an idle globe reads 0', () => {
    const stats = createFrameStats(100);
    for (let at = 0; at < 2000; at += 100) stats.recordCpu(at, 1);
    expect(stats.summary(1950).framesLastSecond).toBe(10);
    expect(stats.summary(10_000).framesLastSecond).toBe(0);
  });

  it('measures the gaps between frames, which give the frame rate', () => {
    const stats = createFrameStats(100);
    // 20 frames at 60 fps, then one 50 ms hitch.
    for (let i = 0; i < 20; i++) stats.recordCpu(i * (1000 / 60), 1);
    stats.recordCpu(19 * (1000 / 60) + 50, 1);
    const s = stats.summary(1000);
    expect(s.intervalMeanMs).toBeCloseTo((19 * (1000 / 60) + 50) / 20, 9);
    expect(s.intervalP95Ms).toBeCloseTo(1000 / 60, 9);
    expect(stats.summary(1000).intervalP95Ms).not.toBeNull();
  });

  it('orders timestamps before differencing, once the ring has wrapped', () => {
    const stats = createFrameStats(4);
    for (let i = 0; i < 7; i++) stats.recordCpu(i * 10, 1);
    expect(stats.summary(100)).toMatchObject({ intervalMeanMs: 10, intervalP95Ms: 10 });
  });

  it('has no interval with fewer than two frames', () => {
    const stats = createFrameStats(4);
    stats.recordCpu(0, 1);
    expect(stats.summary(0)).toMatchObject({ intervalMeanMs: null, intervalP95Ms: null });
  });

  it('reset empties every buffer', () => {
    const stats = createFrameStats(4);
    stats.recordCpu(0, 1);
    stats.recordGpu(1);
    stats.reset();
    expect(stats.summary(0)).toMatchObject({ frames: 0, gpuFrames: 0, cpuMeanMs: null });
  });

  it('rejects a nonsensical capacity', () => {
    expect(() => createFrameStats(0)).toThrow(RangeError);
  });
});
