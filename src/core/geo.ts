/**
 * Geo math and real-world scale.
 *
 * The globe is modelled at radius 1 in world units; everything that needs real
 * distances converts through here so the renderer never hardcodes kilometres.
 *
 * `latLonToVec3` is deliberately pinned to THREE.SphereGeometry's own vertex/UV
 * layout rather than to a textbook convention. Pins, arcs and the texture all
 * have to agree on where a coordinate is, and SphereGeometry decides where the
 * texture is. src/globe/geometry.test.ts checks every vertex against this file.
 *
 * Plain numbers only — src/core cannot import three, so callers convert Vec3.
 */

/** IUGG mean Earth radius. */
export const EARTH_RADIUS_KM = 6371.0088;

/** Obliquity of the ecliptic, J2000, to the precision anyone can see. */
export const EARTH_AXIAL_TILT_DEG = 23.44;

/** Globe radius in world units. Scale conversions below are relative to this. */
export const GLOBE_RADIUS = 1;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface LatLon {
  /** Degrees, -90 (south) to 90 (north). */
  readonly lat: number;
  /** Degrees, -180 to 180. Values outside that range are wrapped. */
  readonly lon: number;
}

/** Texture coordinates in three's convention: v = 1 is the top row (north). */
export interface Uv {
  readonly u: number;
  readonly v: number;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function degToRad(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

export function kmToWorld(km: number): number {
  return (km / EARTH_RADIUS_KM) * GLOBE_RADIUS;
}

export function worldToKm(units: number): number {
  return (units / GLOBE_RADIUS) * EARTH_RADIUS_KM;
}

/** Wraps a longitude into [-180, 180). 180 and -180 are the same meridian. */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Surface position for a coordinate.
 *
 *   phi   = (lon + 180) * PI/180      azimuth, 0 at the antimeridian
 *   theta = (90 - lat)  * PI/180      polar angle, 0 at the north pole
 *
 *   x = -r * cos(phi) * sin(theta)
 *   y =  r * cos(theta)
 *   z =  r * sin(phi) * sin(theta)
 *
 * This is SphereGeometry's loop solved for u = (lon + 180) / 360 and
 * uv.y = (lat + 90) / 180 — the equirectangular layout the NASA maps use.
 * Consequences worth knowing: (0, 0) sits on +X, lon -90 on +Z (so a camera on
 * +Z faces the Americas, not Greenwich), and lon +/-180 on -X.
 */
export function latLonToVec3(at: LatLon, radius: number = GLOBE_RADIUS): Vec3 {
  const phi = (at.lon + 180) * DEG_TO_RAD;
  const theta = (90 - at.lat) * DEG_TO_RAD;
  const ring = radius * Math.sin(theta);
  return {
    x: -ring * Math.cos(phi),
    y: radius * Math.cos(theta),
    z: ring * Math.sin(phi),
  };
}

/** Inverse of latLonToVec3. Radius is ignored; the origin maps to (0, 0). */
export function vec3ToLatLon(v: Vec3): LatLon {
  const r = Math.hypot(v.x, v.y, v.z);
  if (r === 0) return { lat: 0, lon: 0 };

  // Clamp before asin: float error can push |y / r| a hair past 1 at the poles.
  const lat = Math.asin(Math.min(1, Math.max(-1, v.y / r))) * RAD_TO_DEG;
  // From x = -ring*cos(phi), z = ring*sin(phi): phi = atan2(z, -x).
  const phi = Math.atan2(v.z, -v.x);
  return { lat, lon: normalizeLon(phi * RAD_TO_DEG - 180) };
}

/** Where a coordinate lands on an equirectangular texture. u is in [0, 1). */
export function latLonToUv(at: LatLon): Uv {
  return {
    u: (normalizeLon(at.lon) + 180) / 360,
    v: (at.lat + 90) / 180,
  };
}

/** Inverse of latLonToUv. u = 0 and u = 1 are both the antimeridian. */
export function uvToLatLon(uv: Uv): LatLon {
  return {
    lat: uv.v * 180 - 90,
    lon: uv.u * 360 - 180,
  };
}
