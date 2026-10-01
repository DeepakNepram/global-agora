/**
 * Search over what the app already holds: the gazetteer, the payload's
 * stories and places, and the outlet index. Nothing is asked of a server per
 * keystroke, so results come in a few milliseconds (Prompt 3.4: under 150 ms).
 *
 * Each source is indexed once (normalised text, word starts marked by a
 * leading space) and a query is a pass of string comparisons:
 *
 *   tier 0  the whole name equals the query
 *   tier 1  the name starts with it
 *   tier 2  a word in the name starts with it
 *   tier 3  it appears inside a word (queries of 3+ characters)
 *
 * A headline matches when every query word starts one of its words.
 */

import { CATEGORY_LABELS, categoryAt } from './categories';
import type { City, Country, Gazetteer } from './data/places';
import type { OutletsIndex } from './data/outlets';
import { vec3ToLatLon } from './geo';
import { NEWS_CATEGORIES, type NewsCategory, type NodeBuffer } from './nodeBuffer';
import { nearestCity, CITY_RADIUS_KM } from './places';

export const SEARCH_LIMITS = { places: 5, topics: 3, stories: 5, outlets: 3 } as const;

/** Shorter queries would match half of everything. */
export const MIN_QUERY_LENGTH = 2;
const SUBSTRING_MIN_LENGTH = 3;

/** Lower case, accents off ("São" → "sao"), punctuation to spaces, runs collapsed. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** How well `query` names `name` (both normalised), or null. Lower is better. */
export function matchTier(name: string, query: string): number | null {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (` ${name}`.includes(` ${query}`)) return 2;
  if (query.length >= SUBSTRING_MIN_LENGTH && name.includes(query)) return 3;
  return null;
}

export interface PlaceResult {
  readonly kind: 'country' | 'city' | 'place';
  /** Unique within the results, for list keys. */
  readonly key: string;
  readonly label: string;
  /** A second line: the country's code, a city's country, a place's stories. */
  readonly detail: string;
  readonly lat: number;
  readonly lon: number;
  /** For a country: how far it reaches, to frame it. 0 otherwise. */
  readonly radiusDeg: number;
  readonly country: Country | null;
  readonly city: City | null;
}

export interface TopicResult {
  readonly kind: 'topic';
  readonly key: string;
  readonly label: string;
  readonly category: NewsCategory;
  /** Stories in it in the payload. */
  readonly count: number;
}

export interface StoryResult {
  readonly kind: 'story';
  readonly key: string;
  readonly label: string;
  readonly row: number;
  readonly id: number;
}

export interface OutletResult {
  readonly kind: 'outlet';
  readonly key: string;
  readonly label: string;
  readonly outlet: string;
  readonly count: number;
}

export interface SearchResults {
  readonly places: readonly PlaceResult[];
  readonly topics: readonly TopicResult[];
  readonly stories: readonly StoryResult[];
  readonly outlets: readonly OutletResult[];
}

export const NO_RESULTS: SearchResults = { places: [], topics: [], stories: [], outlets: [] };

/** One searchable thing and the names it answers to. */
export interface SearchEntry<T> {
  /** Normalised names: the first is the display name, the rest aliases. */
  readonly names: readonly string[];
  readonly item: T;
  /** Breaks ties within a tier: bigger first. */
  readonly weight: number;
}

/** The gazetteer, indexed. Countries outrank any city of the same tier. */
export function indexPlaces(places: Gazetteer): SearchEntry<PlaceResult>[] {
  const countries = places.countries.map((country) => ({
    names: [country.name, ...country.aliases].map(normalizeSearch),
    weight: Number.MAX_SAFE_INTEGER,
    item: {
      kind: 'country' as const,
      key: `country:${country.code}`,
      label: country.name,
      detail: 'Country',
      lat: country.lat,
      lon: country.lon,
      radiusDeg: country.radiusDeg,
      country,
      city: null,
    },
  }));
  const cities = places.cities.map((city) => ({
    names: [city.name, city.ascii].filter((name) => name !== '').map(normalizeSearch),
    weight: city.population,
    item: {
      kind: 'city' as const,
      key: `city:${city.id}`,
      label: city.name,
      detail: city.countryName,
      lat: city.lat,
      lon: city.lon,
      radiusDeg: 0,
      country: null,
      city,
    },
  }));
  return [...countries, ...cities];
}

export interface StoryIndex {
  readonly headlines: readonly string[];
  /** Places named by stories but by no gazetteer city near them. */
  readonly places: readonly SearchEntry<PlaceResult>[];
  readonly topics: readonly SearchEntry<TopicResult>[];
}

/**
 * The payload, indexed: its headlines, its categories with their counts, and
 * the places its stories name that the gazetteer does not have within
 * CITY_RADIUS_KM (a village in the news), so those can be flown to as well.
 */
export function indexStories(nodes: NodeBuffer, places: Gazetteer | null): StoryIndex {
  const headlines = nodes.headlines
    .slice(0, nodes.count)
    .map((headline) => ` ${normalizeSearch(headline)}`);
  const counts = new Array<number>(NEWS_CATEGORIES.length).fill(0);
  const seen = new Map<string, { row: number; count: number }>();
  for (let row = 0; row < nodes.count; row++) {
    counts[nodes.categories[row] ?? 0] = (counts[nodes.categories[row] ?? 0] ?? 0) + 1;
    const place = nodes.places[row] ?? '';
    if (place === '') continue;
    const entry = seen.get(place);
    if (entry) entry.count++;
    else seen.set(place, { row, count: 1 });
  }
  const storyPlaces: SearchEntry<PlaceResult>[] = [];
  for (const [label, { row, count }] of seen) {
    const at = vec3ToLatLon({
      x: nodes.positions[row * 3] ?? 0,
      y: nodes.positions[row * 3 + 1] ?? 0,
      z: nodes.positions[row * 3 + 2] ?? 0,
    });
    if (places !== null && nearestCity(places, at, CITY_RADIUS_KM) !== null) continue;
    storyPlaces.push({
      names: [normalizeSearch(label.split(',')[0] ?? label), normalizeSearch(label)],
      weight: count,
      item: {
        kind: 'place',
        key: `place:${label}`,
        label,
        detail: count === 1 ? '1 story' : `${count} stories`,
        lat: at.lat,
        lon: at.lon,
        radiusDeg: 0,
        country: null,
        city: null,
      },
    });
  }
  const topics = NEWS_CATEGORIES.map((category, i) => ({
    names: [normalizeSearch(CATEGORY_LABELS[category])],
    weight: counts[i] ?? 0,
    item: {
      kind: 'topic' as const,
      key: `topic:${category}`,
      label: CATEGORY_LABELS[category],
      category: categoryAt(i),
      count: counts[i] ?? 0,
    },
  }));
  return { headlines, places: storyPlaces, topics };
}

/** The outlet index, indexed: "hindustantimes.com" answers to "hindustan". */
export function indexOutlets(index: OutletsIndex): SearchEntry<OutletResult>[] {
  return index.outlets.map((outlet, i) => ({
    names: [normalizeSearch(outlet)],
    weight: index.n[i] ?? 0,
    item: {
      kind: 'outlet',
      key: `outlet:${outlet}`,
      label: outlet,
      outlet,
      count: index.n[i] ?? 0,
    },
  }));
}

/** The best `limit` of `entries` for `query`: by tier, then weight. */
function best<T>(entries: readonly SearchEntry<T>[], query: string, limit: number): T[] {
  const found: { tier: number; weight: number; item: T }[] = [];
  for (const entry of entries) {
    let tier: number | null = null;
    for (const name of entry.names) {
      const t = matchTier(name, query);
      if (t !== null && (tier === null || t < tier)) tier = t;
    }
    if (tier !== null) found.push({ tier, weight: entry.weight, item: entry.item });
  }
  found.sort((a, b) => a.tier - b.tier || b.weight - a.weight);
  return found.slice(0, limit).map((entry) => entry.item);
}

export interface SearchSources {
  readonly places: readonly SearchEntry<PlaceResult>[] | null;
  readonly stories: StoryIndex | null;
  readonly nodes: NodeBuffer | null;
  readonly outlets: readonly SearchEntry<OutletResult>[] | null;
}

/**
 * Results for `raw`, grouped and capped by SEARCH_LIMITS. Stories are those
 * published by the displayed instant `nowSec` (what the globe can show),
 * newest first.
 */
export function search(sources: SearchSources, raw: string, nowSec: number): SearchResults {
  const query = normalizeSearch(raw);
  if (query.length < MIN_QUERY_LENGTH) return NO_RESULTS;

  const placeEntries = [...(sources.places ?? []), ...(sources.stories?.places ?? [])];
  const places = best(placeEntries, query, SEARCH_LIMITS.places);
  const topics = best(sources.stories?.topics ?? [], query, SEARCH_LIMITS.topics);
  const outlets = best(sources.outlets ?? [], query, SEARCH_LIMITS.outlets);

  const stories: StoryResult[] = [];
  const { nodes } = sources;
  const headlines = sources.stories?.headlines ?? [];
  if (nodes !== null) {
    const words = query.split(' ').map((word) => ` ${word}`);
    // Rows are in time order, so walking back finds the newest first.
    for (let row = Math.min(nodes.count, headlines.length) - 1; row >= 0; row--) {
      if (nodes.epochSec + (nodes.publishedSec[row] ?? 0) > nowSec) continue;
      const headline = headlines[row] ?? '';
      if (!words.every((word) => headline.includes(word))) continue;
      stories.push({
        kind: 'story',
        key: `story:${nodes.ids[row] ?? row}`,
        label: nodes.headlines[row] ?? '',
        row,
        id: nodes.ids[row] ?? 0,
      });
      if (stories.length === SEARCH_LIMITS.stories) break;
    }
  }
  return { places, topics, stories, outlets };
}

export function resultCount(results: SearchResults): number {
  return (
    results.places.length + results.topics.length + results.stories.length + results.outlets.length
  );
}
