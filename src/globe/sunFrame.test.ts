import { Group, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { latLonToVec3, sunDirection } from '@/core';

import { sunInSpinFrame, toVector3 } from './sunFrame';
import { earthTiltQuaternion } from './views';

describe('sunInSpinFrame', () => {
  it('gives the spun shell the same ndl as the ground beneath it', () => {
    // Mirror the real graph: tilt -> (earth, cloudSpin -> clouds).
    const tilt = new Group();
    earthTiltQuaternion(tilt.quaternion);
    const earth = new Object3D();
    const cloudSpin = new Group();
    const clouds = new Object3D();
    cloudSpin.add(clouds);
    tilt.add(earth, cloudSpin);

    const sunEarthFixed = toVector3(sunDirection(new Date('2026-09-13T00:39Z')));

    for (const spin of [0, 0.7, 2.1, 4.4, 6.2]) {
      cloudSpin.rotation.y = spin;
      tilt.updateMatrixWorld(true);
      const sunInClouds = sunInSpinFrame(sunEarthFixed, spin);

      for (const place of [
        { lat: 28.6, lon: 77.2 },
        { lat: -33.9, lon: 151.2 },
        { lat: 64.1, lon: -21.9 },
      ]) {
        // Same world-space point, expressed in each mesh's own frame.
        const world = earth.localToWorld(toVector3(latLonToVec3(place)));
        const earthNormal = earth.worldToLocal(world.clone()).normalize();
        const cloudNormal = clouds.worldToLocal(world.clone()).normalize();

        expect(cloudNormal.dot(sunInClouds)).toBeCloseTo(earthNormal.dot(sunEarthFixed), 10);
      }
    }
  });

  it('is the identity when the shell has not spun', () => {
    const v = new Vector3(0.3, -0.4, 0.866).normalize();
    expect(sunInSpinFrame(v, 0).distanceTo(v)).toBeLessThan(1e-12);
  });
});
