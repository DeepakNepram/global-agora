import { describe, expect, it } from 'vitest';

import { summariseBloom } from './bloomReport';

describe('summariseBloom', () => {
  it('counts only frames inside each window, with the interval into the first', () => {
    const summary = summariseBloom([
      {
        window: { startMs: 100, endMs: 150, moving: 120, planMs: 0.8 },
        capture: {
          frames: [
            { atMs: 90, cpuMs: 9 },
            { atMs: 101, cpuMs: 1 },
            { atMs: 108, cpuMs: 2 },
            { atMs: 130, cpuMs: 3 },
            { atMs: 160, cpuMs: 99 },
          ],
          gpu: [
            { atMs: 90, ms: 50 },
            { atMs: 108, ms: 4 },
            { atMs: 200, ms: 5 },
            { atMs: 400, ms: 60 },
          ],
        },
      },
    ]);
    expect(summary).toMatchObject({
      windows: 1,
      moving: 120,
      durationMs: 50,
      frames: 3,
      intervalMaxMs: 22,
      slowerThan60fps: 1,
      cpuMaxMs: 3,
      gpuMaxMs: 5,
      planMaxMs: 0.8,
    });
  });

  it('reports nothing measured rather than zeros for no frames', () => {
    const summary = summariseBloom([]);
    expect(summary.frames).toBe(0);
    expect(summary.intervalP95Ms).toBeNull();
    expect(summary.planMaxMs).toBeNull();
  });
});
