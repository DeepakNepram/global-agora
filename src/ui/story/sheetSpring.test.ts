import { describe, expect, it } from 'vitest';

import {
  RUBBER_BAND,
  SHEET_OMEGA,
  SHEET_SETTLE_SECONDS,
  dragPosition,
  sheetStops,
  snapStop,
  springAt,
  startSpring,
} from './sheetSpring';

/** Steps a spring at a fixed frame interval, as the rAF loop does. */
function run(spring: ReturnType<typeof startSpring>, frameSeconds: number): number[] {
  const out: number[] = [];
  for (let t = 0; ; t += frameSeconds) {
    const sample = springAt(spring, t);
    out.push(sample.position);
    if (sample.done) return out;
  }
}

describe('sheet spring', () => {
  it('settles in 320 ms, landing exactly', () => {
    const spring = startSpring(400, 0, 0);
    expect(Math.abs(springAt(spring, SHEET_SETTLE_SECONDS - 0.001).position)).toBeLessThan(0.5);
    expect(springAt(spring, SHEET_SETTLE_SECONDS)).toEqual({
      position: 0,
      velocity: 0,
      done: true,
    });
  });

  it('never overshoots from rest', () => {
    for (const position of run(startSpring(400, 0, 0), 1 / 240))
      expect(position).toBeGreaterThanOrEqual(0);
    for (const position of run(startSpring(0, 0, 400), 1 / 240))
      expect(position).toBeLessThanOrEqual(400);
  });

  it('caps a hard flick toward the stop, so it cannot overshoot either', () => {
    const flick = startSpring(400, -20_000, 0);
    expect(flick.velocity).toBeCloseTo(-SHEET_OMEGA * 400, 6);
    for (const position of run(flick, 1 / 240)) expect(position).toBeGreaterThanOrEqual(-1e-9);
  });

  it('keeps a velocity away from the stop, turning back without a jump', () => {
    const spring = startSpring(300, 2000, 0);
    expect(spring.velocity).toBe(2000);
    expect(springAt(spring, 0.01).position).toBeGreaterThan(300);
    expect(springAt(spring, SHEET_SETTLE_SECONDS).position).toBe(0);
  });

  it('is the same curve at 60 and 144 Hz', () => {
    const spring = startSpring(500, -800, 100);
    for (const t of [0, 0.05, 0.1, 0.2, 0.3]) {
      const at60 = springAt(spring, Math.round(t * 60) / 60);
      const at144 = springAt(spring, Math.round(t * 144) / 144);
      // Same function of time; only the sample instants differ by under a frame.
      expect(Math.abs(at60.position - at144.position)).toBeLessThan(25);
    }
    expect(run(spring, 1 / 60).at(-1)).toBe(100);
    expect(run(spring, 1 / 144).at(-1)).toBe(100);
  });
});

describe('dragging and snapping', () => {
  it('follows the finger, resisting above the top stop', () => {
    expect(dragPosition(300, -100, 0)).toBe(200);
    expect(dragPosition(100, -200, 0)).toBe(-100 * RUBBER_BAND);
  });

  it('rests at the nearest stop, or the next one after a flick', () => {
    const stops = [0, 400, 600]; // full, peek, closed
    expect(snapStop(380, 0, stops)).toBe(1);
    expect(snapStop(150, 0, stops)).toBe(0);
    // A downward flick from peek dismisses; an upward one expands.
    expect(snapStop(420, 1500, stops)).toBe(2);
    expect(snapStop(380, -1500, stops)).toBe(0);
  });
});

describe('sheet stops', () => {
  it('peeks a third of the area and opens to 90 %', () => {
    const stops = sheetStops(900);
    expect(stops.full).toBe(0);
    // 810 px tall; a third of the area (300 px) shows at peek.
    expect(stops.peek).toBeCloseTo(510, 6);
    expect(stops.closed).toBeGreaterThan(810);
  });

  it('keeps the peek card readable on a short screen', () => {
    const stops = sheetStops(480);
    expect(432 - stops.peek).toBe(208);
    expect(sheetStops(100).peek).toBe(0);
  });
});
