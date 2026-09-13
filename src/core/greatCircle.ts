/**
 * Great-circle geometry on the unit sphere.
 *
 * Works on direction vectors rather than on lat/lon trigonometry: slerp and
 * atan2(|a x b|, a . b) stay accurate for tiny and near-antipodal separations,
 * where the haversine and spherical-law-of-cosines forms lose digits.
 */

import { latLonToVec3, vec3ToLatLon, type LatLon, type Vec3 } from './geo';

/** Below this, two directions are treated as the same point. */
const COINCIDENT = 1e-12;

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Central angle between two coordinates, in radians, in [0, PI]. */
export function angularDistance(a: LatLon, b: LatLon): number {
  const va = latLonToVec3(a);
  const vb = latLonToVec3(b);
  return Math.atan2(length(cross(va, vb)), dot(va, vb));
}

/**
 * Unit tangent at `a` pointing along the route used when `b` is exactly
 * antipodal and every great circle is equally short. North, so the choice is
 * deterministic and reads naturally; at a pole, toward +X (lat 0, lon 0).
 * src/globe/camera/flight.ts makes the same choice.
 */
export function antipodalTangent(a: Vec3): Vec3 {
  const toward = Math.abs(a.y) < 1 - 1e-9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const along = dot(toward, a);
  const t = { x: toward.x - a.x * along, y: toward.y - a.y * along, z: toward.z - a.z * along };
  const n = length(t);
  return { x: t.x / n, y: t.y / n, z: t.z / n };
}

/**
 * The point a fraction `t` of the way from `a` to `b` along the shorter great
 * circle, moving at constant angular speed.
 *
 *   p(t) = (sin((1 - t) W) a + sin(t W) b) / sin W        W = angle(a, b)
 *
 * For exact antipodes sin W = 0 and the formula is undefined; the route then
 * follows antipodalTangent: p(t) = a cos(t PI) + n sin(t PI).
 */
export function interpolateGreatCircle(a: LatLon, b: LatLon, t: number): LatLon {
  const va = latLonToVec3(a);
  const vb = latLonToVec3(b);
  const omega = Math.atan2(length(cross(va, vb)), dot(va, vb));
  if (omega < COINCIDENT) return { lat: a.lat, lon: a.lon };

  const sinOmega = Math.sin(omega);
  if (sinOmega < 1e-9) {
    const n = antipodalTangent(va);
    const c = Math.cos(t * Math.PI);
    const s = Math.sin(t * Math.PI);
    return vec3ToLatLon({ x: va.x * c + n.x * s, y: va.y * c + n.y * s, z: va.z * c + n.z * s });
  }

  const wa = Math.sin((1 - t) * omega) / sinOmega;
  const wb = Math.sin(t * omega) / sinOmega;
  return vec3ToLatLon({
    x: va.x * wa + vb.x * wb,
    y: va.y * wa + vb.y * wb,
    z: va.z * wa + vb.z * wb,
  });
}
