/**
 * North-up camera orientation as a quaternion, in the Earth-fixed frame.
 *
 * A rig orientation q places the camera at q * (0, 0, d) looking at the centre,
 * with q * (0, 1, 0) as screen up. North-up means that up vector always lies in
 * the plane of Earth's axis and the view direction: zero roll. Every rotation
 * here is an axis-angle quaternion product; there are no Euler angles to gimbal.
 */

import { Quaternion, Vector3 } from 'three';

import { degToRad, type LatLon } from '@/core';

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

const scratchQ = new Quaternion();
const scratchV = new Vector3();

/**
 *   q = qY(a) * qX(-lat)
 *
 * qX(-lat) raises +Z to (0, sin lat, cos lat); qY(a) then swings it about the
 * axis to (sin a cos lat, sin lat, cos a cos lat). Matching src/core
 * latLonToVec3, whose lat-0 meridian point is (cos lon, 0, -sin lon), gives
 * a = lon + 90°.
 */
export function orientationFor(at: LatLon, target: Quaternion = new Quaternion()): Quaternion {
  return yawPitchQuaternion(degToRad(at.lon + 90), degToRad(at.lat), target);
}

function yawPitchQuaternion(yawRad: number, latRad: number, target: Quaternion): Quaternion {
  target.setFromAxisAngle(AXIS_Y, yawRad);
  return target.multiply(scratchQ.setFromAxisAngle(AXIS_X, -latRad));
}

/**
 * The north-up orientation looking down at `direction` (any length). Inverse of
 * the product above: lat = asin(y), a = atan2(x, z). Latitude is clamped so the
 * rig never reaches the pole, where "north-up" has no meaning.
 */
export function orientationForDirection(
  direction: Vector3,
  maxLatRad: number,
  target: Quaternion = new Quaternion(),
): Quaternion {
  const length = direction.length();
  const lat = Math.asin(Math.min(1, Math.max(-1, direction.y / length)));
  const clamped = Math.min(maxLatRad, Math.max(-maxLatRad, lat));
  return yawPitchQuaternion(Math.atan2(direction.x, direction.z), clamped, target);
}

/** Unit vector from the centre to the point under the middle of the screen. */
export function centreOf(q: Quaternion, target: Vector3 = new Vector3()): Vector3 {
  return target.copy(AXIS_Z).applyQuaternion(q);
}

export function latitudeOf(q: Quaternion): number {
  const y = centreOf(q, scratchV).y;
  return Math.asin(Math.min(1, Math.max(-1, y)));
}

/**
 * Turns the rig by yaw about Earth's axis (pre-multiplied: a world-frame
 * rotation) and pitch about the camera's own right axis (post-multiplied: a
 * local rotation). Both keep roll at zero. Pitch is trimmed so the centre stays
 * within +/-maxLat; the pitch actually applied is returned, so inertia can
 * drop the component that hit the clamp.
 */
export function rotateYawPitch(
  q: Quaternion,
  yawRad: number,
  pitchRad: number,
  maxLatRad: number,
): number {
  const lat = latitudeOf(q);
  const applied = Math.min(maxLatRad, Math.max(-maxLatRad, lat + pitchRad)) - lat;
  q.premultiply(scratchQ.setFromAxisAngle(AXIS_Y, yawRad));
  q.multiply(scratchQ.setFromAxisAngle(AXIS_X, -applied)).normalize();
  return applied;
}

/** What the view needs to cast a ray through a pixel. */
export interface ViewGeometry {
  /** tan of half the vertical field of view. */
  readonly tanHalfFov: number;
  readonly aspect: number;
}

const rayOrigin = new Vector3();
const rayDirection = new Vector3();

/**
 * Where the ray through normalised device coordinates (ndcX, ndcY) first meets
 * the unit sphere, for a rig at distance `distance` from the centre. Writes a
 * unit vector to `target` and returns true, or returns false on a miss.
 *
 *   camera-space dir = (ndcX tan(F/2) aspect, ndcY tan(F/2), -1)
 *   |o + t d| = 1  ->  t = -b - sqrt(b^2 - c),  b = o.d,  c = o.o - 1
 */
export function rayHitUnitSphere(
  q: Quaternion,
  distance: number,
  ndcX: number,
  ndcY: number,
  view: ViewGeometry,
  target: Vector3,
): boolean {
  rayOrigin.copy(AXIS_Z).multiplyScalar(distance).applyQuaternion(q);
  rayDirection
    .set(ndcX * view.tanHalfFov * view.aspect, ndcY * view.tanHalfFov, -1)
    .normalize()
    .applyQuaternion(q);
  const b = rayOrigin.dot(rayDirection);
  const c = rayOrigin.lengthSq() - 1;
  const discriminant = b * b - c;
  if (discriminant < 0) return false;
  const t = -b - Math.sqrt(discriminant);
  if (t < 0) return false;
  target.copy(rayOrigin).addScaledVector(rayDirection, t).normalize();
  return true;
}

const hit = new Vector3();
const correction = new Quaternion();

/** Chord length on the unit sphere: ~0.6 mm at Earth scale. */
const ANCHOR_TOLERANCE = 1e-10;
const ANCHOR_MAX_PASSES = 16;

/**
 * Re-aims the rig so the ray through (ndcX, ndcY) lands on `anchor` again after
 * the altitude changed underneath it.
 *
 * Rotating the whole rig by R moves the ray's hit from P' to R P', so
 * R = fromUnitVectors(P', P). That R adds roll, and rebuilding north-up from the
 * new centre removes it but moves the hit again. Repeating is a fixed-point
 * iteration: the error shrinks ~4x per pass at world view and faster lower down,
 * so a wheel frame takes about 8-10 passes of a few vector ops. Two passes left
 * ~1e-3 rad per frame, which compounded to 160 px by city altitude. Returns false
 * if the ray misses the globe (the caller zooms about the centre).
 */
export function keepPointUnderRay(
  q: Quaternion,
  distance: number,
  ndcX: number,
  ndcY: number,
  view: ViewGeometry,
  anchor: Vector3,
  maxLatRad: number,
): boolean {
  for (let i = 0; i < ANCHOR_MAX_PASSES; i++) {
    if (!rayHitUnitSphere(q, distance, ndcX, ndcY, view, hit)) return false;
    if (hit.distanceTo(anchor) < ANCHOR_TOLERANCE) break;
    q.premultiply(correction.setFromUnitVectors(hit, anchor));
    orientationForDirection(centreOf(q, scratchV), maxLatRad, q);
  }
  return true;
}
