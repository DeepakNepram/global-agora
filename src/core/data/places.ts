/**
 * The place gazetteer: Natural Earth's countries and 7,342 cities, built by
 * scripts/places/build.ts into public/data/places.v1.json (columnar, like the
 * news payload). Place search, place follows and the onboarding's home city
 * read it. It is fetched on first need, never at start: about 85 KB with
 * Brotli.
 */

import type { FetchLike } from './nodes';

export const PLACES_PATH = 'data/places.v1.json';
export const PLACES_VERSION = 1;

export interface Country {
  /** ISO 3166-1 alpha-2. */
  readonly code: string;
  readonly name: string;
  /** Other names it goes by: "United States", "USA". */
  readonly aliases: readonly string[];
  /** Where its name is drawn on a map: a good place to look at it from. */
  readonly lat: number;
  readonly lon: number;
  /** How far it reaches from there, degrees of arc, for the camera's height. */
  readonly radiusDeg: number;
}

export interface City {
  /** Natural Earth's ne_id: stable, so a followed city survives a rebuild. */
  readonly id: number;
  readonly name: string;
  /** The name in plain ASCII, when it differs ("Sao Paulo"); else "". */
  readonly ascii: string;
  /** ISO alpha-2, or "" for the few places without one. */
  readonly countryCode: string;
  readonly countryName: string;
  readonly lat: number;
  readonly lon: number;
  /** Two significant figures: for ranking, not for quoting. */
  readonly population: number;
}

export interface Gazetteer {
  readonly countries: readonly Country[];
  readonly cities: readonly City[];
  country(code: string): Country | null;
  city(id: number): City | null;
}

export class PlacesError extends Error {
  override readonly name: string = 'PlacesError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function column<T>(
  table: Record<string, unknown>,
  name: string,
  length: number | null,
  check: (value: unknown) => value is T,
): T[] {
  const values = table[name];
  if (!Array.isArray(values)) throw new PlacesError(`${name} is not a list`);
  if (length !== null && values.length !== length) {
    throw new PlacesError(`${name} has ${values.length} entries, expected ${length}`);
  }
  values.forEach((value: unknown, i) => {
    if (!check(value)) throw new PlacesError(`${name}[${i}] is malformed`);
  });
  return values as T[];
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

function table(value: Record<string, unknown>, name: string): Record<string, unknown> {
  const found = value[name];
  if (!isRecord(found)) throw new PlacesError(`${name} is not a table`);
  return found;
}

/** Validates the file and reads it into objects, coordinates back in degrees. */
export function parsePlaces(value: unknown): Gazetteer {
  if (!isRecord(value) || value['v'] !== PLACES_VERSION) {
    throw new PlacesError('not a version 1 places file');
  }
  const c = table(value, 'countries');
  const codes = column(c, 'code', null, (v): v is string => isText(v) && /^[A-Z]{2}$/.test(v));
  const n = codes.length;
  const names = column(c, 'name', n, isText);
  const aliases = column(c, 'aliases', n, isText);
  const cLat = column(c, 'lat', n, isInt);
  const cLon = column(c, 'lon', n, isInt);
  const radius = column(c, 'radius', n, isInt);
  const countries: Country[] = codes.map((code, i) => ({
    code,
    name: names[i] ?? code,
    aliases: (aliases[i] ?? '').split(',').filter((alias) => alias !== ''),
    lat: (cLat[i] ?? 0) / 100,
    lon: (cLon[i] ?? 0) / 100,
    radiusDeg: (radius[i] ?? 0) / 10,
  }));
  const byCode = new Map(countries.map((country) => [country.code, country]));

  const t = table(value, 'cities');
  const deltas = column(t, 'idDelta', null, isInt);
  const m = deltas.length;
  const cityNames = column(t, 'name', m, isText);
  const ascii = column(t, 'ascii', m, isText);
  const country = column(t, 'country', m, isText);
  const lat = column(t, 'lat', m, isInt);
  const lon = column(t, 'lon', m, isInt);
  const population = column(t, 'population', m, isInt);
  let id = 0;
  const cities: City[] = deltas.map((delta, i) => {
    id += delta;
    const raw = country[i] ?? '';
    // "~Somaliland": a name without an ISO code.
    const code = raw.startsWith('~') ? '' : raw;
    return {
      id,
      name: cityNames[i] ?? '',
      ascii: ascii[i] ?? '',
      countryCode: code,
      countryName: code === '' ? raw.slice(1) : (byCode.get(code)?.name ?? ''),
      lat: (lat[i] ?? 0) / 100,
      lon: (lon[i] ?? 0) / 100,
      population: population[i] ?? 0,
    };
  });
  const byId = new Map(cities.map((city) => [city.id, city]));

  return {
    countries,
    cities,
    country: (code) => byCode.get(code) ?? null,
    city: (cityId) => byId.get(cityId) ?? null,
  };
}

/** Fetches and parses the gazetteer from the app at `baseUrl` (ending in "/"). */
export async function fetchPlaces(
  baseUrl: string,
  options: { fetch?: FetchLike; signal?: AbortSignal } = {},
): Promise<Gazetteer> {
  const fetchFn = options.fetch ?? fetch;
  const response = await fetchFn(`${baseUrl}${PLACES_PATH}`, {
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw new PlacesError(`places: HTTP ${response.status}`);
  return parsePlaces(await response.json());
}
