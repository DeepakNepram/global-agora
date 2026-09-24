import { describe, expect, it } from 'vitest';

import {
  BLOOM_SETTLE_SECONDS,
  GOLDEN_ANGLE_RAD,
  PETAL_SPACING_CSS_PX,
  bloomSeconds,
  petalOffset,
  springAt,
  staggerDelay,
  staggerStep,
} from './bloom';

describe('springAt', () => {
  it('rises from rest to the target without ever overshooting', () => {
    let previous = 0;
    for (let t = 0; t <= 1; t += 0.001) {
      const { u } = springAt(0, 0, 0, 1, t);
      expect(u).toBeGreaterThanOrEqual(previous);
      expect(u).toBeLessThanOrEqual(1);
      previous = u;
    }
  });

  it('closes all but 0.1 % of the way within the settle time, then lands exactly', () => {
    expect(springAt(0, 0, 0, 1, BLOOM_SETTLE_SECONDS - 1e-6).u).toBeGreaterThan(0.999);
    expect(springAt(1, 0, 0, 0, BLOOM_SETTLE_SECONDS - 1e-6).u).toBeLessThan(0.001);
    expect(springAt(1, 0, 0, 0, BLOOM_SETTLE_SECONDS)).toEqual({ u: 0, v: 0 });
    // Visibly moving for most of it, not snapping at the start.
    expect(springAt(0, 0, 0, 1, 0.05).u).toBeLessThan(0.5);
  });

  it('holds still until its start time', () => {
    const early = springAt(0.3, 0, 2, 1, 1.5);
    expect(early.u).toBeCloseTo(0.3, 12);
    expect(early.v).toBe(0);
  });

  it('reports the velocity it is moving at', () => {
    const h = 1e-5;
    for (const t of [0.01, 0.05, 0.12]) {
      const slope = (springAt(0, 0, 0, 1, t + h).u - springAt(0, 0, 0, 1, t - h).u) / (2 * h);
      expect(springAt(0, 0, 0, 1, t).v).toBeCloseTo(slope, 3);
    }
  });

  it('turns back smoothly when retargeted mid-flight', () => {
    const mid = springAt(0, 0, 0, 1, 0.06);
    const back = springAt(mid.u, mid.v, 0.06, 0, 0.06);
    expect(back.u).toBeCloseTo(mid.u, 12);
    expect(back.v).toBeCloseTo(mid.v, 12);
    expect(springAt(mid.u, mid.v, 0.06, 0, 0.06 + BLOOM_SETTLE_SECONDS + 0.05).u).toBeLessThan(
      0.001,
    );
  });
});

describe('stagger', () => {
  it('is the prompt 18 ms per sibling while that fits', () => {
    for (let n = 2; n <= 17; n++) expect(staggerStep(n)).toBeCloseTo(0.018, 12);
    expect(staggerDelay(3, 10, false)).toBeCloseTo(0.054, 12);
  });

  it('keeps any bloom under 600 ms, even for 200 children', () => {
    for (let n = 1; n <= 200; n++) expect(bloomSeconds(n)).toBeLessThan(0.6);
    expect(staggerStep(120) * 1000).toBeCloseTo(2.52, 2);
  });

  it('mirrors the order on the way back', () => {
    expect(staggerDelay(0, 5, true)).toBeCloseTo(staggerDelay(4, 5, false), 12);
    expect(staggerDelay(4, 5, true)).toBe(0);
  });
});

describe('petalOffset', () => {
  it('turns each petal the golden angle and places it at c·√i', () => {
    expect(petalOffset(0)).toEqual({ x: 0, y: 0 });
    for (const i of [1, 2, 7, 119]) {
      const { x, y } = petalOffset(i);
      expect(Math.hypot(x, y)).toBeCloseTo(PETAL_SPACING_CSS_PX * Math.sqrt(i), 9);
      const angle = Math.atan2(y, x);
      const expected = Math.atan2(Math.sin(i * GOLDEN_ANGLE_RAD), Math.cos(i * GOLDEN_ANGLE_RAD));
      expect(angle).toBeCloseTo(expected, 9);
    }
    expect((GOLDEN_ANGLE_RAD * 180) / Math.PI).toBeCloseTo(137.507, 6);
  });

  it('never stacks two petals of a 120-story flower closer than a dot apart', () => {
    const petals = Array.from({ length: 120 }, (_, i) => petalOffset(i));
    let closest = Infinity;
    for (let a = 0; a < petals.length; a++) {
      for (let b = a + 1; b < petals.length; b++) {
        const pa = petals[a];
        const pb = petals[b];
        if (pa && pb) closest = Math.min(closest, Math.hypot(pa.x - pb.x, pa.y - pb.y));
      }
    }
    expect(closest).toBeGreaterThan(7);
  });
});
