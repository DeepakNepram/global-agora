import { Quaternion, Vector3, type PerspectiveCamera } from 'three';

import { GLOBE_RADIUS, degToRad, kmToWorld, vec3ToLatLon, type LatLon } from '@/core';

import { MAX_LATITUDE_DEG, clipPlanes, type CameraPose } from './cameraMath';
import { easeInOutCubic, planFlight } from './flight';
import { orientationFor } from './orientation';

/**
 * The discussion view's camera (Prompt 4.5): it dollies down to the story's
 * city, tilts, and slowly orbits it; leaving brings it back to the pose it
 * left. Pure maths over a pose the rig cannot express (tilt and heading), so
 * the orbit controls stay north-up and the shot hands back to them exactly.
 */

/** A camera looking at a point on the surface from `distanceKm` away. */
export interface ShotPose extends LatLon {
  /** From the camera to the point it looks at, km. */
  readonly distanceKm: number;
  /** Away from straight down, radians. 0 is the globe's own north-up view. */
  readonly tiltRad: number;
  /** Where around the point the camera stands, radians. 0 is due south of it, facing north. */
  readonly headingRad: number;
}

/** How far the orbit leans from straight down: the city and the land beyond it, no horizon. */
export const SHOT_TILT_RAD = degToRad(40);

/** The orbit's distance from a far view: a region around the city fills the visible part. */
export const ORBIT_DISTANCE_KM = 1200;

/** Never closer: at 40° of tilt the camera is still ~115 km up, far above the clouds. */
export const MIN_SHOT_DISTANCE_KM = 150;

/** From a close view the dolly still moves in, to this share of the altitude. */
export const SHOT_CLOSER = 0.6;

/** "Slowly orbits it": one turn in 90 s. */
export const ORBIT_DEG_PER_SECOND = 4;

/** The orbit's speed eases in over this long, so it starts without a jolt. */
export const ORBIT_RAMP_SECONDS = 1;

/** Where the dolly stops for a reader who was at `savedAltitudeKm`. */
export function shotDistanceKm(savedAltitudeKm: number): number {
  return Math.max(MIN_SHOT_DISTANCE_KM, Math.min(ORBIT_DISTANCE_KM, savedAltitudeKm * SHOT_CLOSER));
}

/** The rig's own view as a shot: straight down, north up. */
export function poseShot(pose: CameraPose): ShotPose {
  return { lat: pose.lat, lon: pose.lon, distanceKm: pose.altitudeKm, tiltRad: 0, headingRad: 0 };
}

/**
 * Heading after `seconds` of orbiting. The speed eases in by smoothstep over
 * the ramp T, and the heading is its integral, so both are continuous:
 *   ω(s) = ω · smoothstep(s / T)
 *   heading = ω T g(s / T),  g(u) = u³ − u⁴/2 for u < 1,  u − 1/2 after
 */
export function orbitHeadingRad(seconds: number): number {
  const omega = degToRad(ORBIT_DEG_PER_SECOND);
  const u = Math.max(0, seconds) / ORBIT_RAMP_SECONDS;
  const g = u < 1 ? u ** 3 - u ** 4 / 2 : u - 0.5;
  return omega * ORBIT_RAMP_SECONDS * g;
}

/** The orbit around `city`, `seconds` after it began. */
export function orbitShot(city: LatLon, distanceKm: number, seconds: number): ShotPose {
  return {
    lat: city.lat,
    lon: city.lon,
    distanceKm,
    tiltRad: SHOT_TILT_RAD,
    headingRad: orbitHeadingRad(seconds),
  };
}

/** The signed turn from `from` to `to` the short way round, in (−π, π]. */
export function shortestTurn(from: number, to: number): number {
  const turn = (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return turn > Math.PI ? turn - 2 * Math.PI : turn;
}

export interface ShotMove {
  /** The pose a fraction `t` (0–1, of time) of the way through, eased in and out. */
  sample(t: number): ShotPose;
}

/** planFlight wants a duration; the move samples it by fraction, so any will do. */
const PLAN_MS = 1000;

/**
 * From one shot to another: the centre along a great circle and the distance
 * on flyTo's log-space arc (planFlight), tilt and heading eased alongside, all
 * on one ease-in-out cubic. The last sample is `to` itself, so a move back to
 * poseShot(saved) ends exactly on the saved pose.
 */
export function planShotMove(from: ShotPose, to: ShotPose, maxDistanceKm: number): ShotMove {
  const flight = planFlight(
    { lat: from.lat, lon: from.lon, altitudeKm: from.distanceKm },
    { lat: to.lat, lon: to.lon, altitudeKm: to.distanceKm },
    Math.max(maxDistanceKm, from.distanceKm, to.distanceKm),
    PLAN_MS,
  );
  const turn = shortestTurn(from.headingRad, to.headingRad);
  const centre = new Vector3();
  return {
    sample(t) {
      const c = Math.min(1, Math.max(0, t));
      if (c >= 1) return to;
      const e = easeInOutCubic(c);
      const distanceKm = flight.sample(c * PLAN_MS, centre);
      const at = vec3ToLatLon(centre);
      return {
        lat: at.lat,
        lon: at.lon,
        distanceKm,
        tiltRad: from.tiltRad + (to.tiltRad - from.tiltRad) * e,
        headingRad: from.headingRad + turn * e,
      };
    },
  };
}

export interface ShotTransform {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const frame = new Quaternion();
const local = new Quaternion();
const tilt = new Quaternion();
const offset = new Vector3();

/**
 * Where the camera is for a shot, in world space.
 *
 *   rotation = body · q(lat, lon) · qZ(heading) · qX(tilt)
 *   position = body · q(lat, lon) · [(0, 0, R) + qZ(heading) qX(tilt) (0, 0, d)]
 *
 * In the rig's frame the point looked at is (0, 0, R), and the north-up camera
 * sits at (0, 0, R + d) looking down −Z with north up (+Y). Tilting turns the
 * camera about the east axis through that point (it moves south and looks
 * north); heading turns it about the local vertical. With both 0 this is the
 * rig's camera exactly (cameraRig.apply).
 */
export function shotTransform(
  shot: ShotPose,
  body: Quaternion,
  target: ShotTransform = { position: new Vector3(), quaternion: new Quaternion() },
): ShotTransform {
  const lat = Math.min(MAX_LATITUDE_DEG, Math.max(-MAX_LATITUDE_DEG, shot.lat));
  orientationFor({ lat, lon: shot.lon }, frame);
  local
    .setFromAxisAngle(AXIS_Z, shot.headingRad)
    .multiply(tilt.setFromAxisAngle(AXIS_X, shot.tiltRad));
  offset.set(0, 0, kmToWorld(shot.distanceKm)).applyQuaternion(local);
  offset.z += GLOBE_RADIUS;
  target.quaternion.copy(body).multiply(frame);
  target.position.copy(offset).applyQuaternion(target.quaternion);
  target.quaternion.multiply(local);
  return target;
}

/**
 * A lens shift, in CSS pixels: the picture moves so the point looked at sits
 * at the middle of what a panel leaves visible. Positive x moves it left,
 * positive y moves it up (three's setViewOffset).
 */
export interface LensShift {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Writes a shot to the camera: pose, clip planes for its distance (the nearest
 * geometry is still the ground below, so clipPlanes holds with tilt), and the
 * lens shift. The caller clears the shift (clearViewOffset) before handing the
 * camera back to the orbit controls.
 */
export function applyShot(
  camera: PerspectiveCamera,
  transform: ShotTransform,
  distanceKm: number,
  shift: LensShift | null,
): void {
  camera.position.copy(transform.position);
  camera.quaternion.copy(transform.quaternion);
  const planes = clipPlanes(distanceKm);
  camera.near = planes.near;
  camera.far = planes.far;
  if (shift && (shift.x !== 0 || shift.y !== 0)) {
    // Same size as the full view: a pure shift, not a crop or a zoom.
    camera.setViewOffset(shift.width, shift.height, shift.x, shift.y, shift.width, shift.height);
  } else if (camera.view?.enabled) {
    camera.clearViewOffset();
  } else {
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
}
