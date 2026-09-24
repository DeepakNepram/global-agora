import {
  CLUSTER_REFERENCE_LAT_DEG,
  CLUSTER_TILE_PX,
  EARTH_RADIUS_KM,
  PETAL_LEVEL,
  degToRad,
  worldToKm,
  GLOBE_RADIUS,
} from '@/core';

import { CAMERA_FOV_DEG, panBase, radiansPerScreenHeight } from '../camera/cameraMath';

/**
 * Camera to cluster level. supercluster measures its 44 px radius in Web
 * Mercator tiles, where the world is TILE_PX · 2^z pixels wide; the globe
 * shows the ground at the view centre at
 *   P = viewport height / radiansPerScreenHeight(altitude)
 * screen pixels per radian. Matching the two at the reference latitude, where
 * Mercator stretches ground by 1 / cos(lat):
 *   zoom = log2(2π · P · cos(lat_ref) / TILE_PX)
 * World view is about zoom 2, a 600 km city view about 7, and 50 km at least
 * 9.3 on any screen, so the petal level (9) is always reachable.
 */

/** A level is kept until the zoom leaves it by this much, so a settling camera cannot flicker. */
export const LEVEL_HYSTERESIS = 0.1;

const REFERENCE_SCALE = Math.cos(degToRad(CLUSTER_REFERENCE_LAT_DEG));

export function clusterZoomFor(
  altitudeKm: number,
  viewportCssHeight: number,
  fovDeg: number = CAMERA_FOV_DEG,
): number {
  const radians = radiansPerScreenHeight(Math.max(altitudeKm, 1e-3), fovDeg);
  const pixelsPerRadian = Math.max(1, viewportCssHeight) / radians;
  return Math.log2((2 * Math.PI * pixelsPerRadian * REFERENCE_SCALE) / CLUSTER_TILE_PX);
}

/**
 * The inverse: the altitude at which the view is at `zoom`. From the formula
 * above with radiansPerScreenHeight = panBase · altitude / R:
 *   altitude = 2π · H · cos(lat_ref) · R / (TILE_PX · panBase · 2^zoom)
 */
export function altitudeKmForZoom(
  zoom: number,
  viewportCssHeight: number,
  fovDeg: number = CAMERA_FOV_DEG,
): number {
  const height = Math.max(1, viewportCssHeight);
  return (
    (2 * Math.PI * height * REFERENCE_SCALE * EARTH_RADIUS_KM) /
    (CLUSTER_TILE_PX * panBase(fovDeg) * 2 ** zoom)
  );
}

/** Altitude of a camera looking at the globe's centre from `distance` world units. */
export function altitudeKmAt(distance: number): number {
  return worldToKm(distance - GLOBE_RADIUS);
}

function clampLevel(level: number): number {
  return Math.min(Math.max(level, 0), PETAL_LEVEL);
}

/**
 * The level to show at `zoom`, given the one shown now (null at first). The
 * current level holds across [L − h, L + 1 + h); outside it, floor(zoom).
 */
export function nextClusterLevel(current: number | null, zoom: number): number {
  if (!Number.isFinite(zoom)) return current ?? 0;
  if (current === null) return clampLevel(Math.floor(zoom));
  const lower = current <= 0 ? -Infinity : current - LEVEL_HYSTERESIS;
  const upper = current >= PETAL_LEVEL ? Infinity : current + 1 + LEVEL_HYSTERESIS;
  if (zoom >= lower && zoom < upper) return current;
  return clampLevel(Math.floor(zoom));
}
