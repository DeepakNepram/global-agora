import { describe, expect, it } from 'vitest';

import { createFrameGovernor, frameDue, REST_FRAME_INTERVAL_MS } from './frameGovernor';

/** Draw times when vsync ticks at `hz` for `seconds`, with up to `jitterMs` of timestamp noise. */
function draws(hz: number, seconds: number, jitterMs = 0): number[] {
  const governor = createFrameGovernor();
  const drawn: number[] = [];
  const period = 1000 / hz;
  for (let i = 0; i * period < seconds * 1000; i++) {
    const noise = jitterMs === 0 ? 0 : Math.sin(i * 12.9898) * jitterMs;
    const now = 1000 + i * period + noise;
    if (frameDue(governor, now, REST_FRAME_INTERVAL_MS)) drawn.push(now);
  }
  return drawn;
}

function meanInterval(times: readonly number[]): number {
  return ((times.at(-1) ?? 0) - (times[0] ?? 0)) / (times.length - 1);
}

describe('frameDue', () => {
  it('draws every other vsync at 60 Hz', () => {
    const times = draws(60, 4);
    expect(meanInterval(times)).toBeCloseTo(1000 / 30, 6);
    for (let i = 1; i < times.length; i++) {
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeCloseTo(1000 / 30, 6);
    }
  });

  it('holds every other vsync at 60 Hz through timestamp jitter', () => {
    const times = draws(60, 4, 0.8);
    for (let i = 1; i < times.length; i++) {
      const gap = (times[i] ?? 0) - (times[i - 1] ?? 0);
      expect(gap).toBeGreaterThan(30);
      expect(gap).toBeLessThan(37);
    }
  });

  it('averages exactly 30 fps at 144 Hz, every fourth or fifth vsync', () => {
    const times = draws(144, 10);
    expect(meanInterval(times)).toBeCloseTo(1000 / 30, 0);
    expect(times.length).toBeGreaterThanOrEqual(299);
    expect(times.length).toBeLessThanOrEqual(301);
  });

  it('does not burst to catch up after an idle spell', () => {
    const governor = createFrameGovernor();
    expect(frameDue(governor, 0, REST_FRAME_INTERVAL_MS)).toBe(true);
    expect(frameDue(governor, 5000, REST_FRAME_INTERVAL_MS)).toBe(true);
    expect(frameDue(governor, 5016, REST_FRAME_INTERVAL_MS)).toBe(false);
  });

  it('draws every frame without a cap', () => {
    const governor = createFrameGovernor();
    expect(frameDue(governor, 10, 0)).toBe(true);
    expect(frameDue(governor, 11, 0)).toBe(true);
  });
});
