/**
 * flyTo's path: rise, travel a great circle, descend.
 *
 * Time runs through ease-in-out cubic, e = ease(t). Altitude is a parabola in
 * log space over e, so a climb from 50 km to 20,000 km reads as an even zoom
 * rather than a sudden leap. Lateral progress along the great circle is weighted
 * by altitude, so the camera travels mostly near the top of the arc.
 */

import { Quaternion, Vector3 } from 'three';

import {
  EARTH_RADIUS_KM,
  angularDistance,
  antipodalTangent,
  latLonToVec3,
  type Vec3,
} from '@/core';

import type { CameraPose } from './cameraMath';

export const MIN_FLIGHT_MS = 800;
export const MAX_FLIGHT_MS = 3000;

/** Peak altitude per radian travelled, in Earth radii. London-Sydney peaks at ~20,500 km. */
export const ARC_LIFT_RADII_PER_RADIAN = 1.2;

const PROGRESS_SAMPLES = 32;

export type FlightResult = 'completed' | 'cancelled';

export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/**
 *   duration = 800 + 2200 * sqrt(angle / PI)     ms, clamped to [800, 3000]
 *
 * sqrt, not linear: a short hop still gets time to read as a move (Paris-London
 * ~1.05 s) while the antipode tops out at 3 s instead of dragging on.
 */
export function flightDurationMs(angleRad: number): number {
  const fraction = Number.isNaN(angleRad) ? 0 : Math.min(1, Math.max(0, angleRad / Math.PI));
  const duration = MIN_FLIGHT_MS + (MAX_FLIGHT_MS - MIN_FLIGHT_MS) * Math.sqrt(fraction);
  return Math.min(MAX_FLIGHT_MS, Math.max(MIN_FLIGHT_MS, duration));
}

/** The top of the arc. Never below either end, so short hops simply do not rise. */
export function peakAltitudeKm(
  angleRad: number,
  fromKm: number,
  toKm: number,
  maxAltitudeKm: number,
): number {
  const lift = Math.min(maxAltitudeKm, ARC_LIFT_RADII_PER_RADIAN * angleRad * EARTH_RADIUS_KM);
  return Math.max(fromKm, toKm, lift);
}

/**
 *   ln h(e) = lerp(ln h0, ln h1, e) + 4 e (1 - e) * (ln peak - ln max(h0, h1))
 *
 * The bump is zero at both ends and largest at e = 0.5. It is measured from the
 * higher end, so a pure zoom (peak = max end) is monotonic with no overshoot.
 */
export function arcAltitudeKm(e: number, fromKm: number, toKm: number, peakKm: number): number {
  const lnFrom = Math.log(fromKm);
  const lnTo = Math.log(toKm);
  const lift = Math.log(peakKm) - Math.max(lnFrom, lnTo);
  return Math.exp(lnFrom + (lnTo - lnFrom) * e + 4 * e * (1 - e) * lift);
}

export interface Flight {
  readonly durationMs: number;
  readonly angleRad: number;
  /** Writes the view centre (unit vector, Earth-fixed) and returns the altitude in km. */
  sample(elapsedMs: number, centre: Vector3): number;
}

function toVector3(v: Vec3): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

/**
 * Plans a flight. Allocates its tables once here; sample() allocates nothing.
 *
 * Lateral progress u(e) = integral_0^e h / integral_0^1 h. The ground's speed
 * across the screen is proportional to (du/dt) / h, which that weighting makes
 * independent of altitude: the departure city does not smear sideways while the
 * camera is still low, and the ground's apparent speed follows the ease curve.
 */
export function planFlight(
  from: CameraPose,
  to: CameraPose,
  maxAltitudeKm: number,
  durationMs?: number,
): Flight {
  const angleRad = angularDistance(from, to);
  const duration = durationMs ?? flightDurationMs(angleRad);
  const peak = peakAltitudeKm(angleRad, from.altitudeKm, to.altitudeKm, maxAltitudeKm);

  const start = toVector3(latLonToVec3(from));
  const axis = toVector3(latLonToVec3(to)).cross(start).negate();
  if (axis.lengthSq() < 1e-18) {
    // Coincident or antipodal: take the same northward route as src/core.
    axis.copy(start).cross(toVector3(antipodalTangent(start)));
  }
  axis.normalize();

  const progress = new Float64Array(PROGRESS_SAMPLES + 1);
  let previous = arcAltitudeKm(0, from.altitudeKm, to.altitudeKm, peak);
  for (let i = 1; i <= PROGRESS_SAMPLES; i++) {
    const h = arcAltitudeKm(i / PROGRESS_SAMPLES, from.altitudeKm, to.altitudeKm, peak);
    progress[i] = (progress[i - 1] ?? 0) + (previous + h) / 2;
    previous = h;
  }
  const total = progress[PROGRESS_SAMPLES] ?? 1;

  const turn = new Quaternion();

  return {
    durationMs: duration,
    angleRad,

    sample(elapsedMs, centre) {
      const t = duration > 0 ? elapsedMs / duration : 1;
      const e = easeInOutCubic(t);
      const position = e * PROGRESS_SAMPLES;
      const index = Math.min(PROGRESS_SAMPLES - 1, Math.floor(position));
      const low = progress[index] ?? 0;
      const high = progress[index + 1] ?? total;
      const u = (low + (high - low) * (position - index)) / total;

      centre.copy(start).applyQuaternion(turn.setFromAxisAngle(axis, u * angleRad));
      return arcAltitudeKm(e, from.altitudeKm, to.altitudeKm, peak);
    },
  };
}
