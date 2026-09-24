/**
 * Where an article's event is, from GDELT's own coordinates. Nothing is
 * geocoded here (Prompt 2.2): an article GDELT did not place has no place.
 */

import { FIPS_TO_ISO } from '../data/fips.ts';
import { LocationType, type GkgLocation } from '../gdelt/gkg.ts';

export interface Place {
  /** Identifies the place across articles: `l:<GDELT feature id>`. */
  readonly key: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  /** ISO 3166-1 alpha-2, converted from GDELT's FIPS. */
  readonly countryCode: string | null;
  readonly type: number;
}

export const MAX_PLACE_NAME_LENGTH = 120;

/**
 * 3 for a city or landmark, 2 for a state or province, 1 for a country. A
 * country is its centroid (the US one is in Kansas), so any finer place wins.
 */
export function precision(type: number): number {
  if (type === LocationType.usCity || type === LocationType.worldCity) return 3;
  if (type === LocationType.usState || type === LocationType.worldState) return 2;
  return 1;
}

/** How much a pin can be trusted, before agreement between articles. */
export function precisionConfidence(type: number): number {
  return [0, 30, 55, 80][precision(type)] ?? 30;
}

export function fipsToIso(fips: string): string | null {
  return FIPS_TO_ISO[fips] ?? null;
}

/** "Washington, Washington, United States" reads as "Washington, United States". */
export function placeName(name: string): string {
  const parts = name.split(',').map((part) => part.trim());
  const deduped = parts.filter((part, i) => part !== '' && part !== parts[i - 1]);
  const text = deduped.join(', ');
  return text.length <= MAX_PLACE_NAME_LENGTH ? text : text.slice(0, MAX_PLACE_NAME_LENGTH);
}

interface Tally {
  location: GkgLocation;
  mentions: number;
  first: number;
  /** GDELT resolves "White House" and "Washington" to one feature; label it by the name used most. */
  names: Map<string, number>;
}

function beats(a: Tally, b: Tally): boolean {
  const pa = precision(a.location.type);
  const pb = precision(b.location.type);
  if (pa !== pb) return pa > pb;
  if (a.mentions !== b.mentions) return a.mentions > b.mentions;
  return a.first < b.first;
}

function commonestName(names: ReadonlyMap<string, number>): string {
  let best = '';
  let count = 0;
  for (const [name, n] of names) {
    if (n > count) {
      best = name;
      count = n;
    }
  }
  return best;
}

/**
 * The article's main place: the most precise type first, then the place
 * mentioned most often, then the one mentioned earliest (datelines come first).
 */
export function primaryPlace(locations: readonly GkgLocation[]): Place | null {
  const tally = new Map<string, Tally>();
  for (const location of locations) {
    const id = `${location.type}:${location.featureId || location.name}`;
    const entry = tally.get(id);
    if (entry === undefined) {
      tally.set(id, {
        location,
        mentions: 1,
        first: location.offset,
        names: new Map([[location.name, 1]]),
      });
    } else {
      entry.mentions++;
      entry.first = Math.min(entry.first, location.offset);
      entry.names.set(location.name, (entry.names.get(location.name) ?? 0) + 1);
    }
  }

  let best: Tally | null = null;
  for (const entry of tally.values()) if (best === null || beats(entry, best)) best = entry;
  if (best === null) return null;

  const { location } = best;
  return {
    key: `l:${location.featureId || location.name.toLowerCase()}`,
    name: placeName(commonestName(best.names)),
    lat: location.lat,
    lon: location.lon,
    countryCode: fipsToIso(location.fips),
    type: location.type,
  };
}
