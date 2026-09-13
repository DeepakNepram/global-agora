import { Group, Vector3, type Quaternion } from 'three';
import { describe, expect, it } from 'vitest';

import { degToRad, latLonToVec3, vec3ToLatLon, type LatLon } from '@/core';

import { earthTiltQuaternion } from '../views';

import {
  centreOf,
  keepPointUnderRay,
  latitudeOf,
  orientationFor,
  orientationForDirection,
  rayHitUnitSphere,
  rotateYawPitch,
} from './orientation';

const MAX_LAT = degToRad(85);
const AXIS = new Vector3(0, 1, 0);
const VIEW = { tanHalfFov: Math.tan(degToRad(17.5)), aspect: 1.5 };

function vec(at: LatLon): Vector3 {
  const v = latLonToVec3(at);
  return new Vector3(v.x, v.y, v.z);
}

function upOf(q: Quaternion): Vector3 {
  return new Vector3(0, 1, 0).applyQuaternion(q);
}

/** Roll: how far screen-up leans out of the plane holding Earth's axis and the view. */
function rollOf(q: Quaternion): number {
  const east = AXIS.clone().cross(centreOf(q)).normalize();
  return Math.abs(Math.asin(upOf(q).dot(east)));
}

/** Deterministic PRNG so a failure reproduces. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLACES: LatLon[] = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 180 },
  { lat: 0, lon: -90 },
  { lat: 51.5, lon: -0.13 },
  { lat: -33.87, lon: 151.21 },
  { lat: 80, lon: 45 },
  { lat: -80, lon: -120 },
];

describe('orientationFor', () => {
  it.each(PLACES)('looks straight down at $lat, $lon, north-up', (at) => {
    const q = orientationFor(at);
    expect(centreOf(q).distanceTo(vec(at))).toBeLessThan(1e-12);
    expect(rollOf(q)).toBeLessThan(1e-12);
    expect(upOf(q).y).toBeGreaterThan(0);
  });

  it.each(PLACES)('agrees with orientationForDirection at $lat, $lon', (at) => {
    const q = orientationForDirection(vec(at).multiplyScalar(3), MAX_LAT);
    expect(centreOf(q).distanceTo(vec(at))).toBeLessThan(1e-12);
    expect(upOf(q).distanceTo(upOf(orientationFor(at)))).toBeLessThan(1e-12);
  });

  it.each([
    { lat: 0, lon: 0 },
    { lat: 0, lon: 180 },
    { lat: 35.68, lon: 139.65 },
  ])('puts $lat, $lon dead centre of the view under the axial tilt', (at) => {
    // The rig composes as body * q; the surface point goes through the same tilt group.
    const tilt = new Group();
    earthTiltQuaternion(tilt.quaternion);
    tilt.updateMatrixWorld();
    const surface = vec(at).applyMatrix4(tilt.matrixWorld);

    const world = earthTiltQuaternion().multiply(orientationFor(at));
    const camera = new Vector3(0, 0, 4).applyQuaternion(world);
    expect(camera.normalize().distanceTo(surface.normalize())).toBeLessThan(1e-9);
  });
});

describe('rotateYawPitch', () => {
  it('moves the centre north by exactly the pitch and east by the yaw', () => {
    const q = orientationFor({ lat: 10, lon: 20 });
    rotateYawPitch(q, degToRad(15), degToRad(5), MAX_LAT);
    const at = vec3ToLatLon(centreOf(q));
    expect(at.lat).toBeCloseTo(15, 9);
    expect(at.lon).toBeCloseTo(35, 9);
  });

  it('trims pitch at the clamp and reports what was applied', () => {
    const q = orientationFor({ lat: 80, lon: 0 });
    const applied = rotateYawPitch(q, 0, degToRad(20), MAX_LAT);
    expect(applied).toBeCloseTo(degToRad(5), 12);
    expect(latitudeOf(q)).toBeCloseTo(MAX_LAT, 12);
  });

  it('never flips over a pole or gains roll across 10k random drags', () => {
    const random = mulberry32(1404);
    const q = orientationFor({ lat: 0, lon: 0 });
    for (let i = 0; i < 10_000; i++) {
      const yaw = (random() - 0.5) * 2;
      const pitch = (random() - 0.5) * (random() < 0.1 ? 6 : 0.5);
      rotateYawPitch(q, yaw, pitch, MAX_LAT);
      expect(Math.abs(latitudeOf(q))).toBeLessThanOrEqual(MAX_LAT + 1e-9);
      expect(upOf(q).y).toBeGreaterThan(0);
    }
    expect(rollOf(q)).toBeLessThan(1e-9);
  });
});

describe('rays', () => {
  it('hits the view centre through the middle of the screen', () => {
    const q = orientationFor({ lat: -20, lon: 60 });
    const hit = new Vector3();
    expect(rayHitUnitSphere(q, 4, 0, 0, VIEW, hit)).toBe(true);
    expect(hit.distanceTo(centreOf(q))).toBeLessThan(1e-12);
  });

  it('misses in the corner of a world view', () => {
    const q = orientationFor({ lat: 0, lon: 0 });
    expect(rayHitUnitSphere(q, 4, 0.95, 0.95, VIEW, new Vector3())).toBe(false);
  });

  it('keeps a surface point under its pixel when the distance changes', () => {
    const q = orientationFor({ lat: 30, lon: -40 });
    const anchor = new Vector3();
    expect(rayHitUnitSphere(q, 3, 0.25, -0.2, VIEW, anchor)).toBe(true);

    // One large jump; the controls make many small ones.
    expect(keepPointUnderRay(q, 1.2, 0.25, -0.2, VIEW, anchor, MAX_LAT)).toBe(true);
    const hit = new Vector3();
    rayHitUnitSphere(q, 1.2, 0.25, -0.2, VIEW, hit);
    expect(hit.angleTo(anchor)).toBeLessThan(1e-4);
    expect(rollOf(q)).toBeLessThan(1e-12);
  });
});
