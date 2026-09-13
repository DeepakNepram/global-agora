import { SphereGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { latLonToVec3, uvToLatLon } from '@/core';

import { CLOUD_RADIUS, EARTH_SEGMENTS } from './earth';
import { earthTiltQuaternion } from './views';

/**
 * The guarantee this file exists for: a coordinate passed to latLonToVec3 lands
 * on the exact vertex whose UV samples that coordinate from the texture. If this
 * holds for every vertex of the real geometry, pins cannot drift off their map.
 * SphereGeometry is plain JS, so this runs in Node with no GL context.
 */
describe('SphereGeometry UVs agree with latLonToVec3', () => {
  it.each([
    ['earth', 1, EARTH_SEGMENTS, EARTH_SEGMENTS],
    ['clouds', CLOUD_RADIUS, EARTH_SEGMENTS, EARTH_SEGMENTS / 2],
  ])('every vertex of the %s sphere', (_name, radius, widthSegments, heightSegments) => {
    const geometry = new SphereGeometry(radius, widthSegments, heightSegments);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');

    expect(position.count).toBe((widthSegments + 1) * (heightSegments + 1));

    let worst = 0;
    for (let i = 0; i < position.count; i++) {
      // Pole rows carry a half-segment u offset, but at a pole every longitude
      // is the same point, so the comparison still holds exactly there.
      const expected = latLonToVec3(uvToLatLon({ u: uv.getX(i), v: uv.getY(i) }), radius);
      worst = Math.max(
        worst,
        Math.abs(position.getX(i) - expected.x),
        Math.abs(position.getY(i) - expected.y),
        Math.abs(position.getZ(i) - expected.z),
      );
    }
    geometry.dispose();

    // Float32 attribute storage bounds the achievable precision at ~1e-7.
    expect(worst).toBeLessThan(1e-6);
  });

  it('duplicates the seam column so u never wraps inside a triangle', () => {
    const geometry = new SphereGeometry(1, EARTH_SEGMENTS, EARTH_SEGMENTS);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const row = EARTH_SEGMENTS + 1;
    const equatorRow = (EARTH_SEGMENTS / 2) * row;
    const first = equatorRow;
    const last = equatorRow + EARTH_SEGMENTS;

    expect(uv.getX(first)).toBe(0);
    expect(uv.getX(last)).toBe(1);
    expect(position.getX(first)).toBeCloseTo(position.getX(last), 6);
    expect(position.getZ(first)).toBeCloseTo(position.getZ(last), 6);
    geometry.dispose();
  });
});

describe('axial tilt', () => {
  it('tips the north pole 23.44° off vertical', () => {
    const pole = new Vector3(0, 1, 0).applyQuaternion(earthTiltQuaternion());
    const degrees = (Math.acos(pole.y) * 180) / Math.PI;
    expect(degrees).toBeCloseTo(23.44, 6);
  });
  // Camera placement under the tilt is covered by src/globe/camera/orientation.test.ts.
});
