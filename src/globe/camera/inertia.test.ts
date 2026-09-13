import { describe, expect, it } from 'vitest';

import {
  FRICTION,
  HARD_FLICK_SPEED,
  MAX_FLICK_SPEED,
  STOP_SPEED,
  capSpeed,
  createVelocityTracker,
  decayVelocity,
  type ScreenVelocity,
} from './inertia';

function spin(initial: number, fps: number): { seconds: number; travel: number } {
  const velocity: ScreenVelocity = { x: initial, y: 0 };
  let seconds = 0;
  let travel = 0;
  while (velocity.x !== 0 && seconds < 60) {
    travel += decayVelocity(velocity, 1 / fps).dx;
    seconds += 1 / fps;
  }
  return { seconds, travel };
}

describe('flick decay', () => {
  it('derives friction from a 2.5 s hard flick', () => {
    expect(FRICTION).toBeCloseTo(Math.log(HARD_FLICK_SPEED / STOP_SPEED) / 2.5, 12);
  });

  it.each([30, 60, 144])('spins a hard flick for 2-3 seconds at %i fps', (fps) => {
    const { seconds } = spin(HARD_FLICK_SPEED, fps);
    expect(seconds).toBeGreaterThanOrEqual(2);
    expect(seconds).toBeLessThanOrEqual(3);
  });

  it('travels exactly the same distance per second at any frame rate', () => {
    const travelled = [30, 60, 144].map((fps) => {
      const velocity = { x: HARD_FLICK_SPEED, y: 0 };
      let total = 0;
      for (let i = 0; i < fps; i++) total += decayVelocity(velocity, 1 / fps).dx;
      return total;
    });
    const exact = (HARD_FLICK_SPEED * (1 - Math.exp(-FRICTION))) / FRICTION;
    for (const total of travelled) expect(total).toBeCloseTo(exact, 10);
  });

  it('coasts ~v0 / f in total, whatever the frame rate', () => {
    for (const fps of [30, 60, 144]) {
      expect(spin(HARD_FLICK_SPEED, fps).travel).toBeCloseTo(HARD_FLICK_SPEED / FRICTION, 1);
    }
  });

  it('snaps to exactly zero below the stop threshold', () => {
    const velocity = { x: STOP_SPEED * 1.01, y: 0 };
    decayVelocity(velocity, 0.05);
    expect(velocity).toEqual({ x: 0, y: 0 });
  });
});

describe('velocity tracker', () => {
  it('measures a steady drag', () => {
    const tracker = createVelocityTracker();
    tracker.reset(0, 0, 0);
    for (let t = 16; t <= 160; t += 16) tracker.add(t, t, -t / 2); // 1000 px/s right, 500 up
    const v = tracker.release(165, { x: 0, y: 0 });
    expect(v.x).toBeCloseTo(1000, 6);
    expect(v.y).toBeCloseTo(-500, 6);
  });

  it('uses only the tail of the drag', () => {
    const tracker = createVelocityTracker();
    tracker.reset(0, 0, 0);
    tracker.add(400, 10, 0); // slow for 400 ms
    for (let t = 416; t <= 480; t += 16) tracker.add(t, 10 + (t - 400) * 3, 0); // then 3000 px/s
    expect(tracker.release(482, { x: 0, y: 0 }).x).toBeCloseTo(3000, 6);
  });

  it('reports no flick when the pointer rested before lifting', () => {
    const tracker = createVelocityTracker();
    tracker.reset(0, 0, 0);
    for (let t = 16; t <= 160; t += 16) tracker.add(t, t * 5, 0);
    expect(tracker.release(160 + 60, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('reports no flick for a tap', () => {
    const tracker = createVelocityTracker();
    tracker.reset(0, 50, 50);
    expect(tracker.release(10, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('capSpeed', () => {
  it('limits speed and keeps direction', () => {
    const v = capSpeed({ x: 30, y: 40 });
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(MAX_FLICK_SPEED, 12);
    expect(v.y / v.x).toBeCloseTo(40 / 30, 12);
  });
});
