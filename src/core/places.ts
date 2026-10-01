/**
 * What the app asks of the gazetteer (data/places.ts): a city's label, and
 * the city a story's pin is in. Pure functions, no DOM.
 */

import type { City, Gazetteer } from './data/places';
import { EARTH_RADIUS_KM, type LatLon } from './geo';
import { angularDistance } from './greatCircle';

/**
 * A story belongs to a city, for following it, within this distance: wide
 * enough for a metropolitan area (GDELT puts a city's stories on its centre),
 * narrow enough to keep neighbouring cities apart.
 */
export const CITY_RADIUS_KM = 50;

const KM_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_KM;

/** "Tokyo, Japan"; just the name when the country is unknown. */
export function cityLabel(city: City): string {
  return city.countryName === '' ? city.name : `${city.name}, ${city.countryName}`;
}

/** Kilometres between two points along the surface. */
export function surfaceKm(a: LatLon, b: LatLon): number {
  return angularDistance(a, b) * EARTH_RADIUS_KM;
}

/**
 * The city nearest `at` within `maxKm`, or null. Ties (Natural Earth lists a
 * few cities at one point) go to the larger. Cities outside the latitude band
 * are skipped before any trigonometry.
 */
export function nearestCity(
  places: Gazetteer,
  at: LatLon,
  maxKm: number = CITY_RADIUS_KM,
): City | null {
  const band = maxKm / KM_PER_DEGREE;
  let best: City | null = null;
  let bestKm = Infinity;
  for (const city of places.cities) {
    if (Math.abs(city.lat - at.lat) > band) continue;
    const km = surfaceKm(at, city);
    if (km > maxKm) continue;
    if (km < bestKm || (km === bestKm && best !== null && city.population > best.population)) {
      best = city;
      bestKm = km;
    }
  }
  return best;
}
