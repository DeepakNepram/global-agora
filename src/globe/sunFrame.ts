import { Vector3 } from 'three';

import type { Vec3 } from '@/core';

const SPIN_AXIS = new Vector3(0, 1, 0);

/** src/core hands out plain Vec3s; the render layer works in Vector3s. */
export function toVector3(v: Vec3, target: Vector3 = new Vector3()): Vector3 {
  return target.set(v.x, v.y, v.z);
}

/**
 * Re-expresses an Earth-fixed direction in the frame of a child spun `spinY`
 * radians about Earth's axis (the cloud shell). A child's local vector maps to
 * its parent by R_y(spin), so going the other way is R_y(-spin).
 */
export function sunInSpinFrame(
  earthFixed: Vector3,
  spinY: number,
  target: Vector3 = new Vector3(),
): Vector3 {
  return target.copy(earthFixed).applyAxisAngle(SPIN_AXIS, -spinY);
}
