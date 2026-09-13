import { PerspectiveCamera, Ray, Sphere, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_KM, GLOBE_RADIUS, kmToWorld } from '@/core';

import {
  CAMERA_FOV_DEG,
  MIN_ALTITUDE_KM,
  clipPlanes,
  fitAltitudeKm,
  maxAltitudeKm,
  panBase,
  radiansPerPixel,
  radiansPerScreenHeight,
  yawCompensation,
} from './cameraMath';

const UNIT_SPHERE = new Sphere(new Vector3(), GLOBE_RADIUS);

/** Where a pixel ray from a camera straight above (0, 0, 1) hits the globe. */
function hitAt(camera: PerspectiveCamera, ndc: Vector2): Vector3 {
  const origin = camera.position.clone();
  const direction = new Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(origin).normalize();
  const hit = new Ray(origin, direction).intersectSphere(UNIT_SPHERE, new Vector3());
  if (!hit) throw new Error('ray missed the globe');
  return hit;
}

describe('altitude scaling', () => {
  it('is linear in altitude: panSpeed = base * (altitude / EARTH_RADIUS)', () => {
    const perKm = radiansPerScreenHeight(1);
    for (const km of [MIN_ALTITUDE_KM, 400, 6371, 19_000, 30_000]) {
      expect(radiansPerScreenHeight(km)).toBeCloseTo(perKm * km, 12);
    }
    expect(radiansPerScreenHeight(EARTH_RADIUS_KM)).toBeCloseTo(panBase(), 12);
  });

  it('derives the base from the field of view', () => {
    expect(panBase(CAMERA_FOV_DEG)).toBeCloseTo(2 * Math.tan((17.5 * Math.PI) / 180), 12);
  });

  it('locks the ground under the finger at city altitude, within 2%', () => {
    const heightPx = 700;
    const camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1.5, 1e-4, 10);
    camera.position.set(0, 0, GLOBE_RADIUS + kmToWorld(MIN_ALTITUDE_KM));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const dragPx = 100;
    const centre = hitAt(camera, new Vector2(0, 0));
    const moved = hitAt(camera, new Vector2(0, (dragPx / heightPx) * 2));
    const actual = centre.angleTo(moved);
    const predicted = dragPx * radiansPerPixel(MIN_ALTITUDE_KM, heightPx);
    expect(Math.abs(predicted - actual) / actual).toBeLessThan(0.02);
  });

  it('spins continents at world view and moves a few km at city view', () => {
    const worldView = fitAltitudeKm(16 / 9);
    expect((radiansPerScreenHeight(worldView) * 180) / Math.PI).toBeGreaterThan(90);

    const cityDragKm = 100 * radiansPerPixel(MIN_ALTITUDE_KM, 700) * EARTH_RADIUS_KM;
    expect(cityDragKm).toBeGreaterThan(1);
    expect(cityDragKm).toBeLessThan(6);
  });

  it('compensates yaw for latitude, with a floor near the poles', () => {
    expect(yawCompensation(0)).toBe(1);
    expect(yawCompensation(Math.PI / 3)).toBeCloseTo(2, 12);
    expect(yawCompensation((85 * Math.PI) / 180)).toBeCloseTo(1 / 0.35, 12);
  });
});

describe('altitude limits', () => {
  it('fits the globe at 4 radii on landscape and backs off in portrait', () => {
    expect(fitAltitudeKm(16 / 9)).toBeCloseTo(3 * EARTH_RADIUS_KM, 6);
    expect(fitAltitudeKm(0.5)).toBeCloseTo(7 * EARTH_RADIUS_KM, 6);
    expect(maxAltitudeKm(1.5)).toBeCloseTo(1.6 * fitAltitudeKm(1.5), 6);
  });
});

describe('clip planes', () => {
  it('keep the cloud shell and the far side of the atmosphere in view', () => {
    for (const km of [MIN_ALTITUDE_KM, 1000, maxAltitudeKm(1)]) {
      const { near, far } = clipPlanes(km);
      const cloudDistance = kmToWorld(km) - 0.003;
      expect(near).toBeLessThan(cloudDistance);
      expect(far).toBeGreaterThan(GLOBE_RADIUS + kmToWorld(km) + 1.03);
      // 24-bit depth is comfortable well below a 1:10^4 range.
      expect(far / near).toBeLessThan(1e4);
    }
  });
});
