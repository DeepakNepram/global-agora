import { describe, expect, it } from 'vitest';

import {
  EARTH_RADIUS_KM,
  kmToWorld,
  latLonToUv,
  latLonToVec3,
  normalizeLon,
  uvToLatLon,
  vec3ToLatLon,
  worldToKm,
  type Vec3,
} from './geo';

const EPS = 1e-9;

function expectVec(actual: Vec3, expected: Vec3): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.z).toBeCloseTo(expected.z, 9);
}

describe('latLonToVec3 anchors', () => {
  // These pin the convention. If one changes, every pin on the globe moves.
  it.each([
    ['equator at Greenwich', { lat: 0, lon: 0 }, { x: 1, y: 0, z: 0 }],
    ['north pole', { lat: 90, lon: 0 }, { x: 0, y: 1, z: 0 }],
    ['south pole', { lat: -90, lon: 0 }, { x: 0, y: -1, z: 0 }],
    ['lon -90 (Americas)', { lat: 0, lon: -90 }, { x: 0, y: 0, z: 1 }],
    ['lon +90 (Indian Ocean)', { lat: 0, lon: 90 }, { x: 0, y: 0, z: -1 }],
    ['antimeridian', { lat: 0, lon: 180 }, { x: -1, y: 0, z: 0 }],
  ])('%s', (_label, at, expected) => {
    expectVec(latLonToVec3(at), expected);
  });

  it('puts lon 180 and lon -180 on the same point', () => {
    expectVec(latLonToVec3({ lat: 37, lon: 180 }), latLonToVec3({ lat: 37, lon: -180 }));
  });

  it('scales with radius', () => {
    expectVec(latLonToVec3({ lat: 0, lon: 0 }, 1.003), { x: 1.003, y: 0, z: 0 });
  });
});

describe('vec3ToLatLon', () => {
  it.each([
    [0, 0],
    [51.4779, -0.0015], // Greenwich
    [35.6762, 139.6503], // Tokyo
    [-33.8688, 151.2093], // Sydney
    [64.1466, -21.9426], // Reykjavik
    [-54.8019, -68.303], // Ushuaia
    [12, 179.999],
    [-12, -179.999],
  ])('round-trips (%f, %f)', (lat, lon) => {
    const back = vec3ToLatLon(latLonToVec3({ lat, lon }, 2.5));
    expect(back.lat).toBeCloseTo(lat, 9);
    expect(back.lon).toBeCloseTo(lon, 9);
  });

  it('returns a latitude of +/-90 at the poles without NaN', () => {
    expect(vec3ToLatLon({ x: 0, y: 1, z: 0 }).lat).toBeCloseTo(90, 12);
    expect(vec3ToLatLon({ x: 0, y: -3, z: 0 }).lat).toBeCloseTo(-90, 12);
  });

  it('does not NaN at the origin', () => {
    expect(vec3ToLatLon({ x: 0, y: 0, z: 0 })).toEqual({ lat: 0, lon: 0 });
  });
});

describe('normalizeLon', () => {
  it.each([
    [0, 0],
    [179, 179],
    [180, -180],
    [-180, -180],
    [190, -170],
    [-190, 170],
    [540, -180],
    [-725, -5],
  ])('%f -> %f', (input, expected) => {
    expect(normalizeLon(input)).toBeCloseTo(expected, 9);
  });
});

describe('UV mapping', () => {
  it('matches the equirectangular corners', () => {
    expect(latLonToUv({ lat: 90, lon: -180 })).toEqual({ u: 0, v: 1 });
    expect(latLonToUv({ lat: -90, lon: 0 })).toEqual({ u: 0.5, v: 0 });
    expect(latLonToUv({ lat: 0, lon: 90 })).toEqual({ u: 0.75, v: 0.5 });
  });

  it('round-trips through uvToLatLon', () => {
    const at = { lat: -23.5, lon: 46.6 };
    const back = uvToLatLon(latLonToUv(at));
    expect(back.lat).toBeCloseTo(at.lat, 9);
    expect(back.lon).toBeCloseTo(at.lon, 9);
  });

  it('treats u = 0 and u = 1 as the same meridian', () => {
    const left = latLonToVec3(uvToLatLon({ u: 0, v: 0.3 }));
    const right = latLonToVec3(uvToLatLon({ u: 1, v: 0.3 }));
    expect(Math.abs(left.x - right.x)).toBeLessThan(EPS);
    expect(Math.abs(left.z - right.z)).toBeLessThan(EPS);
  });
});

describe('scale', () => {
  it('maps one Earth radius to one world unit', () => {
    expect(kmToWorld(EARTH_RADIUS_KM)).toBe(1);
  });

  it('round-trips kilometres', () => {
    expect(worldToKm(kmToWorld(4000))).toBeCloseTo(4000, 9);
  });
});
