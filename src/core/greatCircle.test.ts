import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_KM, latLonToVec3, type LatLon } from './geo';
import { angularDistance, interpolateGreatCircle } from './greatCircle';

const LONDON: LatLon = { lat: 51.5074, lon: -0.1278 };
const NEW_YORK: LatLon = { lat: 40.7128, lon: -74.006 };
const SYDNEY: LatLon = { lat: -33.8688, lon: 151.2093 };
const TOKYO: LatLon = { lat: 35.6762, lon: 139.6503 };
const SAN_FRANCISCO: LatLon = { lat: 37.7749, lon: -122.4194 };

describe('angularDistance', () => {
  it('matches the published London - New York distance', () => {
    // ~5570 km on the mean sphere.
    expect(Math.abs(angularDistance(LONDON, NEW_YORK) * EARTH_RADIUS_KM - 5570)).toBeLessThan(10);
  });

  it('is symmetric, zero on itself and PI between antipodes', () => {
    expect(angularDistance(LONDON, SYDNEY)).toBeCloseTo(angularDistance(SYDNEY, LONDON), 12);
    expect(angularDistance(TOKYO, TOKYO)).toBe(0);
    expect(angularDistance({ lat: 10, lon: 20 }, { lat: -10, lon: -160 })).toBeCloseTo(Math.PI, 9);
  });

  it('treats lon 180 and -180 as the same meridian', () => {
    expect(angularDistance({ lat: 5, lon: 180 }, { lat: 5, lon: -180 })).toBeLessThan(1e-9);
  });
});

describe('interpolateGreatCircle', () => {
  it('starts at a and ends at b', () => {
    const start = interpolateGreatCircle(LONDON, SYDNEY, 0);
    const end = interpolateGreatCircle(LONDON, SYDNEY, 1);
    expect(angularDistance(start, LONDON)).toBeLessThan(1e-9);
    expect(angularDistance(end, SYDNEY)).toBeLessThan(1e-9);
  });

  it('moves at constant angular speed', () => {
    const total = angularDistance(LONDON, SYDNEY);
    for (const t of [0.1, 0.25, 0.5, 0.8]) {
      const p = interpolateGreatCircle(LONDON, SYDNEY, t);
      expect(angularDistance(LONDON, p)).toBeCloseTo(t * total, 9);
      expect(angularDistance(p, SYDNEY)).toBeCloseTo((1 - t) * total, 9);
    }
  });

  it('stays on the plane of the two endpoints', () => {
    const a = latLonToVec3(NEW_YORK);
    const b = latLonToVec3(TOKYO);
    const normal = {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
    for (let t = 0; t <= 1; t += 0.125) {
      const p = latLonToVec3(interpolateGreatCircle(NEW_YORK, TOKYO, t));
      expect(Math.abs(p.x * normal.x + p.y * normal.y + p.z * normal.z)).toBeLessThan(1e-9);
    }
  });

  it('crosses the antimeridian the short way', () => {
    // Tokyo to San Francisco goes over the Pacific, never through lon 0.
    for (let t = 0; t <= 1; t += 0.1) {
      const p = interpolateGreatCircle(TOKYO, SAN_FRANCISCO, t);
      expect(Math.abs(p.lon)).toBeGreaterThan(100);
    }
  });

  it('picks a deterministic northward route between exact antipodes', () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 0, lon: 180 };
    const mid = interpolateGreatCircle(a, b, 0.5);
    expect(mid.lat).toBeCloseTo(90, 6);
    expect(interpolateGreatCircle(a, b, 0.5)).toEqual(mid);
    expect(angularDistance(interpolateGreatCircle(a, b, 1), b)).toBeLessThan(1e-9);
  });

  it('returns the start when both ends coincide', () => {
    expect(interpolateGreatCircle(TOKYO, TOKYO, 0.7)).toEqual(TOKYO);
  });
});
