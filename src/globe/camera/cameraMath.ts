/**
 * Camera scale: how far a drag turns the globe, how high the camera may go, and
 * where its clip planes sit. Pure numbers so the feel can be unit-tested.
 */

import { EARTH_RADIUS_KM, GLOBE_RADIUS, degToRad, kmToWorld, type LatLon } from '@/core';

import { ATMOSPHERE_RADIUS } from '../shaders/atmosphere.glsl';

/** The camera pose as plain, serialisable data (share URLs, discussion panel). */
export interface CameraPose extends LatLon {
  /** Height of the camera above the surface, kilometres. */
  readonly altitudeKm: number;
}

export const CAMERA_FOV_DEG = 35;

/** Closest approach. A 100px drag at this height moves the ground ~3 km. */
export const MIN_ALTITUDE_KM = 50;

/** World view: camera distance in globe radii that fits the globe on a landscape viewport. */
export const FIT_DISTANCE = 4;

/** How far past the world view the camera may pull back. */
export const MAX_ALTITUDE_FIT_MULTIPLE = 1.6;

/** Pitch clamp. Past ~85° north-up yaw spins the view about the pole too quickly to follow. */
export const MAX_LATITUDE_DEG = 85;

/** Floor for the latitude compensation of horizontal drags; see yawCompensation. */
const MIN_YAW_COMPENSATION = 0.35;

/**
 * Ground under a finger at low altitude. Straight down from height h with a
 * vertical field of view F, one screen height spans 2 h tan(F/2) of ground, so
 * a drag of one screen height should turn the globe by 2 tan(F/2) * h / R rad.
 */
export function panBase(fovDeg: number = CAMERA_FOV_DEG): number {
  return 2 * Math.tan(degToRad(fovDeg) / 2);
}

/**
 * Globe rotation for one screen height of drag:
 *
 *   rad = panBase * (altitude / EARTH_RADIUS)
 *
 * Linear in altitude. At world view a drag spins continents; at 50 km the same
 * drag moves a few kilometres. This is the prompt's non-negotiable formula.
 */
export function radiansPerScreenHeight(
  altitudeKm: number,
  fovDeg: number = CAMERA_FOV_DEG,
): number {
  return panBase(fovDeg) * (altitudeKm / EARTH_RADIUS_KM);
}

export function radiansPerPixel(
  altitudeKm: number,
  viewportHeightPx: number,
  fovDeg: number = CAMERA_FOV_DEG,
): number {
  return radiansPerScreenHeight(altitudeKm, fovDeg) / Math.max(1, viewportHeightPx);
}

/**
 * Yaw turns about Earth's axis, which moves ground at the view centre by only
 * yaw * cos(lat). Dividing by cos(lat) keeps a horizontal drag locked to the
 * ground at high latitudes; the floor stops it running away near the clamp.
 */
export function yawCompensation(latRad: number): number {
  return 1 / Math.max(Math.cos(latRad), MIN_YAW_COMPENSATION);
}

/**
 * World-view altitude for a viewport. Portrait viewports are width-limited, so
 * the camera backs off by the aspect ratio to keep the limb on screen.
 */
export function fitAltitudeKm(aspect: number): number {
  const distance = FIT_DISTANCE / Math.min(1, Math.max(aspect, 1e-3));
  return (distance - GLOBE_RADIUS) * EARTH_RADIUS_KM;
}

export function maxAltitudeKm(aspect: number): number {
  return fitAltitudeKm(aspect) * MAX_ALTITUDE_FIT_MULTIPLE;
}

export function clampAltitudeKm(altitudeKm: number, aspect: number): number {
  return Math.min(maxAltitudeKm(aspect), Math.max(MIN_ALTITUDE_KM, altitudeKm));
}

export interface ClipPlanes {
  readonly near: number;
  readonly far: number;
}

/**
 * Near and far follow altitude. A fixed near of 0.1 clips the globe below
 * ~600 km. The camera always looks at the centre, so the nearest geometry is the
 * cloud shell 19 km up, never closer than ~0.6 of the altitude at the minimum;
 * the farthest is the back of the atmosphere shell.
 */
export function clipPlanes(altitudeKm: number): ClipPlanes {
  const altitude = kmToWorld(altitudeKm);
  return {
    near: altitude * 0.3,
    far: GLOBE_RADIUS + altitude + GLOBE_RADIUS * ATMOSPHERE_RADIUS + 0.1,
  };
}
