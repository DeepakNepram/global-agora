import { Euler, Quaternion } from 'three';

import { EARTH_AXIAL_TILT_DEG, degToRad } from '@/core';

/**
 * The single source of Earth's tilt. The globe's tilt group and the camera rig
 * (src/globe/camera, as its body orientation) both use this, so "look at
 * lat/lon" stays correct under the tilt.
 *
 * About X, not Z. Greenwich and the antimeridian sit on the X axis, so a Z tilt
 * would put the terminator's seasonal lean inside the plane of the prime
 * meridian view. Negative tips the north pole toward -Z.
 */
export function earthTiltQuaternion(target: Quaternion = new Quaternion()): Quaternion {
  return target.setFromEuler(new Euler(-degToRad(EARTH_AXIAL_TILT_DEG), 0, 0));
}
