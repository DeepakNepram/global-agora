import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';

import { angularDistance, latLonToVec3, type LatLon } from '@/core';

import { earthTiltQuaternion } from '../views';

import { MIN_ALTITUDE_KM, radiansPerPixel } from './cameraMath';
import { createOrbitGlobeControls } from './OrbitGlobeControls';
import type { OrbitGlobeControls } from './types';

const WIDTH = 1000;
const HEIGHT = 700;
const FRAME = 1 / 60;

function setup(requestFrame: () => void = () => undefined): OrbitGlobeControls {
  const camera = new PerspectiveCamera(35, WIDTH / HEIGHT, 0.1, 100);
  const controls = createOrbitGlobeControls({
    camera,
    bodyOrientation: earthTiltQuaternion(),
    requestFrame,
  });
  controls.setViewport(WIDTH, HEIGHT);
  return controls;
}

/** Runs frames until update() stops asking for more; returns seconds simulated. */
function runUntilIdle(controls: OrbitGlobeControls, maxSeconds = 10): number {
  let seconds = 0;
  while (controls.update(FRAME) && seconds < maxSeconds) seconds += FRAME;
  return seconds + FRAME;
}

/** Drags from (x, y) by (dx, dy) over `ms`, in 8 ms samples; returns the end time. */
function drag(
  controls: OrbitGlobeControls,
  from: { x: number; y: number; t: number },
  dx: number,
  dy: number,
  ms: number,
): number {
  controls.pointerDown({ id: 1, x: from.x, y: from.y, timeMs: from.t });
  const steps = Math.round(ms / 8);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    controls.pointerMove({ id: 1, x: from.x + dx * f, y: from.y + dy * f, timeMs: from.t + i * 8 });
    controls.update(FRAME);
  }
  return from.t + steps * 8;
}

function angleBetween(a: LatLon | null, b: LatLon | null): number {
  if (!a || !b) throw new Error('expected a surface point');
  return angularDistance(a, b);
}

describe('pose state', () => {
  it('round-trips getState and setState', () => {
    const controls = setup();
    const pose = { lat: 35.6762, lon: 139.6503, altitudeKm: 800 };
    controls.setState(pose);
    const back = controls.getState();
    expect(back.lat).toBeCloseTo(pose.lat, 9);
    expect(back.lon).toBeCloseTo(pose.lon, 9);
    expect(back.altitudeKm).toBe(pose.altitudeKm);
    expect(JSON.parse(JSON.stringify(back))).toEqual(back);
  });

  it('clamps latitude and altitude', () => {
    const controls = setup();
    controls.setState({ lat: 89, lon: 0, altitudeKm: 1 });
    expect(controls.getState().lat).toBeCloseTo(85, 9);
    expect(controls.getState().altitudeKm).toBe(MIN_ALTITUDE_KM);
    controls.setState({ lat: 0, lon: 0, altitudeKm: 1e9 });
    expect(controls.getState().altitudeKm).toBe(controls.getLimits().maxKm);
  });

  it('asks for no frames when nothing moves', () => {
    const controls = setup();
    expect(controls.update(FRAME)).toBe(false);
    expect(controls.getTelemetry().mode).toBe('idle');
  });
});

describe('drag', () => {
  it('keeps the ground under the finger at city altitude, at 50°N', () => {
    const controls = setup();
    controls.setState({ lat: 50, lon: 10, altitudeKm: MIN_ALTITUDE_KM });
    const grabbed = controls.surfacePointAt(500, 350);
    const end = drag(controls, { x: 500, y: 350, t: 0 }, 120, 60, 400);
    controls.pointerUp({ id: 1, x: 620, y: 410, timeMs: end + 100 });

    const moved = 134 * radiansPerPixel(MIN_ALTITUDE_KM, HEIGHT);
    expect(angleBetween(controls.surfacePointAt(620, 410), grabbed) / moved).toBeLessThan(0.05);
  });

  it('carries a hard flick for 2-3 seconds, then stops asking for frames', () => {
    const controls = setup();
    // 4 screen heights per second, straight across.
    const end = drag(controls, { x: 100, y: 350, t: 0 }, 4 * HEIGHT * 0.12, 0, 120);
    controls.pointerUp({ id: 1, x: 100 + 4 * HEIGHT * 0.12, y: 350, timeMs: end });
    expect(controls.getTelemetry().mode).toBe('inertia');
    expect(controls.getTelemetry().carriedDegPerSecond).toBeGreaterThan(0);

    const seconds = runUntilIdle(controls);
    expect(seconds).toBeGreaterThanOrEqual(2);
    expect(seconds).toBeLessThanOrEqual(3);
    expect(controls.getTelemetry().mode).toBe('idle');
  });

  it('does not coast when the pointer rested before lifting', () => {
    const controls = setup();
    const end = drag(controls, { x: 100, y: 350, t: 0 }, 300, 0, 120);
    controls.pointerUp({ id: 1, x: 400, y: 350, timeMs: end + 200 });
    expect(controls.update(FRAME)).toBe(false);
  });
});

describe('zoom toward the pointer', () => {
  it('keeps the point under the cursor within half a pixel, 30,000 km to 50 km', () => {
    const controls = setup();
    controls.setState({ lat: 20, lon: 10, altitudeKm: 30_000 });
    const pixel = { x: 600, y: 300 };
    const anchor = controls.surfacePointAt(pixel.x, pixel.y);
    expect(anchor).not.toBeNull();

    for (let i = 0; i < 12; i++) {
      controls.wheel({ deltaPx: -500, ...pixel });
      for (let f = 0; f < 3; f++) controls.update(FRAME);
    }
    runUntilIdle(controls);

    expect(controls.getState().altitudeKm).toBe(MIN_ALTITUDE_KM);
    const errorRad = angleBetween(controls.surfacePointAt(pixel.x, pixel.y), anchor);
    expect(errorRad / radiansPerPixel(MIN_ALTITUDE_KM, HEIGHT)).toBeLessThan(0.5);
  });

  it('zooms about the centre when the cursor is over space', () => {
    const controls = setup();
    controls.setState({ lat: 20, lon: 10, altitudeKm: 30_000 });
    controls.wheel({ deltaPx: -300, x: 5, y: 5 });
    runUntilIdle(controls);
    expect(controls.getState().lat).toBeCloseTo(20, 9);
    expect(controls.getState().altitudeKm).toBeLessThan(30_000);
  });

  it('pinches toward the midpoint, locked under both fingers', () => {
    const controls = setup();
    controls.setState({ lat: 0, lon: 0, altitudeKm: 2000 });
    const mid = { x: 600, y: 400 };
    const anchor = controls.surfacePointAt(mid.x, mid.y);
    controls.pointerDown({ id: 1, x: 500, y: 400, timeMs: 0 });
    controls.pointerDown({ id: 2, x: 700, y: 400, timeMs: 0 });
    controls.pointerMove({ id: 1, x: 400, y: 400, timeMs: 16 });
    controls.pointerMove({ id: 2, x: 800, y: 400, timeMs: 16 });
    expect(controls.getTelemetry().mode).toBe('pinch');
    expect(controls.getState().altitudeKm).toBeCloseTo(1000, 6);
    expect(angleBetween(controls.surfacePointAt(mid.x, mid.y), anchor)).toBeLessThan(1e-6);
  });
});

describe('flyTo', () => {
  const LONDON = { lat: 51.5074, lon: -0.1278 };
  const SYDNEY = { lat: -33.8688, lon: 151.2093 };

  it('arrives on time and resolves completed', async () => {
    const controls = setup();
    controls.setState({ ...LONDON, altitudeKm: 600 });
    const flight = controls.flyTo(SYDNEY.lat, SYDNEY.lon, 600);
    controls.update(0); // the first step after idle
    expect(controls.getTelemetry().mode).toBe('flight');

    const seconds = runUntilIdle(controls);
    await expect(flight).resolves.toBe('completed');
    expect(seconds).toBeGreaterThan(2.7);
    expect(seconds).toBeLessThan(2.95);
    const end = controls.getState();
    expect(angularDistance(end, SYDNEY)).toBeLessThan(1e-9);
    expect(end.altitudeKm).toBe(600);
  });

  it('is cancelled by a pointer and leaves the camera where it was', async () => {
    const controls = setup();
    controls.setState({ ...LONDON, altitudeKm: 600 });
    const flight = controls.flyTo(SYDNEY.lat, SYDNEY.lon, 600);
    for (let i = 0; i < 60; i++) controls.update(FRAME);
    const midAir = controls.getState();

    controls.pointerDown({ id: 1, x: 500, y: 350, timeMs: 0 });
    await expect(flight).resolves.toBe('cancelled');
    expect(controls.update(FRAME)).toBe(false);
    expect(angularDistance(controls.getState(), midAir)).toBeLessThan(1e-12);
  });

  it('is cancelled by the next flight', async () => {
    const controls = setup();
    const first = controls.flyTo(SYDNEY.lat, SYDNEY.lon, 600);
    const second = controls.flyTo(LONDON.lat, LONDON.lon, 600);
    await expect(first).resolves.toBe('cancelled');
    runUntilIdle(controls);
    await expect(second).resolves.toBe('completed');
  });

  it('does not jump after a long idle gap', () => {
    const controls = setup();
    controls.setState({ ...LONDON, altitudeKm: 600 });
    void controls.flyTo(SYDNEY.lat, SYDNEY.lon, 600);
    // r3f's first delta after idle can be minutes.
    expect(controls.update(120)).toBe(true);
    expect(angularDistance(controls.getState(), LONDON)).toBeLessThan(0.01);
  });
});

describe('reduced motion', () => {
  it('cuts flights and drops inertia', async () => {
    const controls = setup();
    controls.setMotion('reduced');
    await expect(controls.flyTo(10, 20, 900)).resolves.toBe('completed');
    expect(controls.getState().lat).toBeCloseTo(10, 9);

    const end = drag(controls, { x: 100, y: 350, t: 0 }, 300, 0, 120);
    controls.pointerUp({ id: 1, x: 400, y: 350, timeMs: end });
    expect(controls.update(FRAME)).toBe(false);
  });
});

describe('keyboard and render on demand', () => {
  it('nudges east and zooms in steps, requesting frames', () => {
    const requestFrame = vi.fn();
    const controls = setup(requestFrame);
    controls.setState({ lat: 0, lon: 0, altitudeKm: 5000 });
    requestFrame.mockClear();

    controls.nudge(1, 0);
    runUntilIdle(controls);
    expect(controls.getState().lon).toBeGreaterThan(0);

    controls.zoomStep('in');
    runUntilIdle(controls);
    expect(controls.getState().altitudeKm).toBeLessThan(5000);
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });

  it('places the camera on the tilted globe, looking straight down', () => {
    const camera = new PerspectiveCamera(35, 1, 0.1, 100);
    const controls = createOrbitGlobeControls({ camera, bodyOrientation: earthTiltQuaternion() });
    controls.setState({ lat: -33.8688, lon: 151.2093, altitudeKm: 1000 });
    const v = latLonToVec3({ lat: -33.8688, lon: 151.2093 });
    const surface = new Vector3(v.x, v.y, v.z).applyQuaternion(earthTiltQuaternion());
    expect(camera.position.clone().normalize().distanceTo(surface)).toBeLessThan(1e-9);
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(forward.dot(surface)).toBeCloseTo(-1, 9);
  });
});
