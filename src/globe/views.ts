import { Euler, Quaternion, Vector3, type Camera } from 'three';

import { EARTH_AXIAL_TILT_DEG, degToRad, latLonToVec3, type LatLon } from '@/core';

const WORLD_UP = new Vector3(0, 1, 0);
const ORIGIN = new Vector3(0, 0, 0);
/** Fallback screen-up when looking (almost) straight down the world Y axis. */
const FALLBACK_UP = new Vector3(0, 0, -1);

/**
 * The single source of Earth's tilt. The globe's tilt group and every camera
 * placement both use this, so "look at lat/lon" stays correct under the tilt.
 *
 * About X, not Z. Greenwich and the antimeridian sit on the X axis, so a Z tilt
 * puts those cameras inside the tilt plane and the axis projects dead vertical —
 * correct in world space and invisible on screen. Negative tips the north pole
 * toward -Z, which reads as a lean to the right from the default +X camera.
 */
export function earthTiltQuaternion(target: Quaternion = new Quaternion()): Quaternion {
  return target.setFromEuler(new Euler(-degToRad(EARTH_AXIAL_TILT_DEG), 0, 0));
}

/**
 * World-space position a distance above a coordinate on the tilted globe.
 * Only valid while the earth mesh itself is unrotated inside its tilt group —
 * true in 1.1; revisit when the globe gets a daily spin.
 */
export function cameraPositionFor(
  at: LatLon,
  distance: number,
  target: Vector3 = new Vector3(),
): Vector3 {
  const local = latLonToVec3(at, distance);
  return target.set(local.x, local.y, local.z).applyQuaternion(earthTiltQuaternion());
}

/**
 * Points a camera at a coordinate. World up is kept as screen up so the 23.44°
 * tilt stays visible; it is swapped out only near the degenerate case where
 * the view direction is parallel to it.
 */
export function aimCamera(camera: Camera, at: LatLon, distance: number): void {
  cameraPositionFor(at, distance, camera.position);
  const alignment = Math.abs(camera.position.clone().normalize().dot(WORLD_UP));
  camera.up.copy(alignment > 0.999 ? FALLBACK_UP : WORLD_UP);
  camera.lookAt(ORIGIN);
  camera.updateMatrixWorld();
}
