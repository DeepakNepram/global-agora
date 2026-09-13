/**
 * Where the sun is overhead for a given instant.
 *
 * Low-precision solar position from the Astronomical Almanac: roughly 0.01° in
 * declination and a few seconds in the equation of time between 1950 and 2050.
 * That is far below anything the terminator's ±5.7° soft band could show, and
 * it costs a handful of trig calls instead of a VSOP87 table.
 *
 * Time always arrives as an argument. Nothing in here may read the clock: the
 * scrubber replays the past through these same functions.
 */

import { latLonToVec3, normalizeLon, type LatLon, type Vec3 } from './geo';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const MS_PER_DAY = 86_400_000;

/** Julian Day of the Unix epoch, 1970-01-01T00:00Z. */
const JD_UNIX_EPOCH = 2_440_587.5;
/** Julian Day of J2000.0, 2000-01-01T12:00 TT. */
const JD_J2000 = 2_451_545.0;

function mod360(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function julianDay(date: Date): number {
  return date.getTime() / MS_PER_DAY + JD_UNIX_EPOCH;
}

interface SolarCoordinates {
  /** Mean longitude of the sun, degrees in [0, 360). */
  readonly meanLongitude: number;
  /** Declination, degrees. */
  readonly declination: number;
  /** Right ascension, degrees in (-180, 180]. */
  readonly rightAscension: number;
}

function solarCoordinates(date: Date): SolarCoordinates {
  const n = julianDay(date) - JD_J2000;

  // L = mean longitude, g = mean anomaly (degrees).
  const L = mod360(280.46 + 0.9856474 * n);
  const g = mod360(357.528 + 0.9856003 * n) * DEG_TO_RAD;

  // Ecliptic longitude: mean longitude plus the equation of centre.
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG_TO_RAD;
  // Obliquity of the ecliptic, drifting slowly from its J2000 value.
  const epsilon = (23.439 - 0.0000004 * n) * DEG_TO_RAD;

  // declination = asin(sin(epsilon) * sin(lambda))
  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda)) * RAD_TO_DEG;
  // alpha = atan2(cos(epsilon) * sin(lambda), cos(lambda))
  const rightAscension =
    Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) * RAD_TO_DEG;

  return { meanLongitude: L, declination, rightAscension };
}

/**
 * Apparent minus mean solar time, in minutes. Positive means a sundial runs
 * ahead of the clock (early November, about +16.4), negative means behind
 * (mid February, about -14.2).
 *
 *   EoT = L - alpha     (degrees, wrapped to ±180; 1° = 4 minutes)
 */
export function equationOfTimeMinutes(date: Date): number {
  const { meanLongitude, rightAscension } = solarCoordinates(date);
  return normalizeLon(meanLongitude - rightAscension) * 4;
}

/**
 * The point on Earth where the sun is at the zenith.
 *
 * Longitude comes from requiring apparent solar time to be exactly noon there:
 *
 *   UTC + lon/15 + EoT/60 = 12h   =>   lon = 180 - 15 * UTC_hours - EoT_degrees
 *
 * so it moves west at 15° per hour and is nudged by up to ~4° across the year.
 */
export function subsolarPoint(date: Date): LatLon {
  const { meanLongitude, declination, rightAscension } = solarCoordinates(date);
  const eotDegrees = normalizeLon(meanLongitude - rightAscension);

  const msIntoUtcDay = ((date.getTime() % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  const utcHours = msIntoUtcDay / 3_600_000;

  return {
    lat: declination,
    lon: normalizeLon(180 - 15 * utcHours - eotDegrees),
  };
}

/**
 * Unit vector from Earth's centre toward the sun, in the Earth-fixed globe frame
 * (the frame latLonToVec3 and the surface textures use). Because it is fixed to
 * the ground rather than to world space, shading needs no knowledge of the axial
 * tilt, the camera, or any future spin of the globe mesh.
 */
export function sunDirection(date: Date): Vec3 {
  return latLonToVec3(subsolarPoint(date), 1);
}
