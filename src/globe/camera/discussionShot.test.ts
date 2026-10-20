import { PerspectiveCamera, type Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { angularDistance, latLonToVec3, worldToKm, type LatLon } from '@/core';

import { CLOUD_RADIUS } from '../earth';
import { earthTiltQuaternion } from '../views';

import { clipPlanes } from './cameraMath';
import {
  MIN_SHOT_DISTANCE_KM,
  ORBIT_DEG_PER_SECOND,
  ORBIT_DISTANCE_KM,
  ORBIT_RAMP_SECONDS,
  SHOT_TILT_RAD,
  applyShot,
  orbitHeadingRad,
  orbitShot,
  planShotMove,
  poseShot,
  shortestTurn,
  shotDistanceKm,
  shotTransform,
  type ShotPose,
} from './discussionShot';
import { createOrbitGlobeControls } from './OrbitGlobeControls';

const BODY = earthTiltQuaternion();
const BENGALURU: LatLon = { lat: 12.9716, lon: 77.5946 };
const WORLD = { lat: 20, lon: -40, altitudeKm: 19_000 };
const MAX_KM = 40_000;

/** The camera the orbit controls place for `pose`. */
function rigCamera(pose: { lat: number; lon: number; altitudeKm: number }): PerspectiveCamera {
  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  const controls = createOrbitGlobeControls({ camera, bodyOrientation: BODY });
  controls.setViewport(1000, 1000);
  controls.setState(pose);
  return camera;
}

/** The surface point a shot looks at, in world space. */
function lookedAt(shot: ShotPose): Vector3 {
  const v = latLonToVec3(shot);
  return new Vector3(v.x, v.y, v.z).applyQuaternion(BODY);
}

function forward(quaternion: Quaternion): Vector3 {
  return new Vector3(0, 0, -1).applyQuaternion(quaternion);
}

describe('shotTransform', () => {
  it('is the orbit controls camera exactly at tilt 0 and heading 0', () => {
    for (const pose of [
      WORLD,
      { lat: -33.87, lon: 151.21, altitudeKm: 800 },
      { lat: 84, lon: 179, altitudeKm: 60 },
    ]) {
      const rig = rigCamera(pose);
      const shot = shotTransform(poseShot(pose), BODY);
      expect(shot.position.distanceTo(rig.position)).toBeLessThan(1e-12);
      expect(Math.abs(shot.quaternion.dot(rig.quaternion))).toBeCloseTo(1, 12);
    }
  });

  it('keeps the city dead ahead at the shot distance, whatever the tilt and heading', () => {
    for (const tiltRad of [0, 0.3, SHOT_TILT_RAD]) {
      for (const headingRad of [0, 1, 4]) {
        const shot: ShotPose = { ...BENGALURU, distanceKm: 1200, tiltRad, headingRad };
        const { position, quaternion } = shotTransform(shot, BODY);
        const toCity = lookedAt(shot).sub(position);
        expect(worldToKm(toCity.length())).toBeCloseTo(1200, 6);
        expect(toCity.normalize().dot(forward(quaternion))).toBeCloseTo(1, 12);
      }
    }
  });

  it('tilts toward the horizon: the camera stands south of the city and looks north', () => {
    const shot: ShotPose = {
      ...BENGALURU,
      distanceKm: 1200,
      tiltRad: SHOT_TILT_RAD,
      headingRad: 0,
    };
    const below = new Vector3()
      .copy(shotTransform(shot, BODY).position)
      .applyQuaternion(BODY.clone().invert());
    const ground = {
      lat: Math.asin(below.y / below.length()) * (180 / Math.PI),
      lon: BENGALURU.lon,
    };
    expect(ground.lat).toBeLessThan(BENGALURU.lat);
    // The angle from straight down is the tilt, seen from the city.
    const up = lookedAt(shot).normalize();
    const toCamera = shotTransform(shot, BODY).position.clone().sub(lookedAt(shot)).normalize();
    expect(Math.acos(up.dot(toCamera))).toBeCloseTo(SHOT_TILT_RAD, 10);
  });

  it('never takes the camera under the clouds', () => {
    const move = planShotMove(
      poseShot({ lat: 0, lon: 0, altitudeKm: 50 }),
      orbitShot(BENGALURU, MIN_SHOT_DISTANCE_KM, 0),
      MAX_KM,
    );
    for (let t = 0; t <= 1; t += 1 / 64) {
      const height = shotTransform(move.sample(t), BODY).position.length();
      expect(height).toBeGreaterThan(CLOUD_RADIUS);
    }
  });
});

describe('shotDistanceKm', () => {
  it('stops at the orbit distance from far away, closer from close in, never below the floor', () => {
    expect(shotDistanceKm(19_000)).toBe(ORBIT_DISTANCE_KM);
    expect(shotDistanceKm(1000)).toBeCloseTo(600, 9);
    expect(shotDistanceKm(50)).toBe(MIN_SHOT_DISTANCE_KM);
  });
});

describe('orbitHeadingRad', () => {
  const omega = (ORBIT_DEG_PER_SECOND * Math.PI) / 180;

  it('starts still and eases into the orbit speed with no jump', () => {
    expect(orbitHeadingRad(0)).toBe(0);
    expect(orbitHeadingRad(-1)).toBe(0);
    const dt = 1e-4;
    const speedAt = (s: number): number =>
      (orbitHeadingRad(s + dt) - orbitHeadingRad(s - dt)) / (2 * dt);
    expect(speedAt(dt)).toBeLessThan(omega * 0.01);
    expect(speedAt(ORBIT_RAMP_SECONDS)).toBeCloseTo(omega, 4);
    expect(
      orbitHeadingRad(ORBIT_RAMP_SECONDS + 10) - orbitHeadingRad(ORBIT_RAMP_SECONDS),
    ).toBeCloseTo(omega * 10, 10);
  });
});

describe('shortestTurn', () => {
  it('goes the short way round', () => {
    expect(shortestTurn(6.2, 0)).toBeCloseTo(2 * Math.PI - 6.2, 12);
    expect(shortestTurn(0.5, 0)).toBeCloseTo(-0.5, 12);
    expect(shortestTurn(0, 3 * Math.PI)).toBeCloseTo(Math.PI, 12);
  });
});

describe('planShotMove', () => {
  it('starts where it is, and ends exactly on the target', () => {
    const from = poseShot(WORLD);
    const to = orbitShot(BENGALURU, ORBIT_DISTANCE_KM, 0);
    const move = planShotMove(from, to, MAX_KM);
    const start = move.sample(0);
    expect(angularDistance(start, from)).toBeLessThan(1e-12);
    expect(start.distanceKm).toBeCloseTo(from.distanceKm, 6);
    expect(start.tiltRad).toBe(0);
    expect(move.sample(1)).toBe(to);
    expect(move.sample(2)).toBe(to);
  });

  it('moves continuously: no frame jumps the camera', () => {
    const move = planShotMove(poseShot(WORLD), orbitShot(BENGALURU, ORBIT_DISTANCE_KM, 0), MAX_KM);
    let previous = shotTransform(move.sample(0), BODY).position.clone();
    for (let i = 1; i <= 240; i++) {
      const next = shotTransform(move.sample(i / 240), BODY).position.clone();
      // 240 steps over a move of at most a few globe radii.
      expect(next.distanceTo(previous)).toBeLessThan(0.08);
      previous = next;
    }
  });

  it('brings an orbiting camera back to the saved pose exactly, unwinding the short way', () => {
    const saved = { lat: 48.8566, lon: 2.3522, altitudeKm: 4200 };
    const orbiting = orbitShot(BENGALURU, shotDistanceKm(saved.altitudeKm), 80);
    expect(orbiting.headingRad).toBeGreaterThan(Math.PI);
    const back = planShotMove(orbiting, poseShot(saved), MAX_KM);
    const halfway = back.sample(0.5);
    expect(Math.abs(halfway.headingRad - orbiting.headingRad)).toBeLessThan(Math.PI / 2);
    const rig = rigCamera(saved);
    const end = shotTransform(back.sample(1), BODY);
    expect(end.position.distanceTo(rig.position)).toBeLessThan(1e-12);
    expect(Math.abs(end.quaternion.dot(rig.quaternion))).toBeCloseTo(1, 12);
  });
});

describe('applyShot', () => {
  it('writes the pose, the clip planes for its distance, and a pure lens shift', () => {
    const camera = new PerspectiveCamera(35, 2, 0.1, 100);
    const shot = orbitShot(BENGALURU, 1200, 3);
    const transform = shotTransform(shot, BODY);
    applyShot(camera, transform, shot.distanceKm, { width: 800, height: 400, x: 200, y: 0 });
    expect(camera.position.equals(transform.position)).toBe(true);
    expect(camera.near).toBe(clipPlanes(1200).near);
    expect(camera.far).toBe(clipPlanes(1200).far);
    expect(camera.view).toMatchObject({ enabled: true, offsetX: 200, width: 800, fullWidth: 800 });

    // The city, straight ahead, lands left of centre: the middle of what a
    // 400 px panel on the right leaves visible.
    const ndc = lookedAt(shot).project(camera);
    expect(ndc.x).toBeCloseTo(-0.5, 6);
    expect(ndc.y).toBeCloseTo(0, 6);

    applyShot(camera, transform, shot.distanceKm, null);
    expect(camera.view?.enabled ?? false).toBe(false);
  });
});
