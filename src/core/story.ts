/**
 * What the story sheet derives from a story and the stories around it: the
 * lead outlet, articles grouped by outlet, "why this location" in plain
 * words, and nearby stories. Pure functions, no DOM.
 */

import type { StoryArticle, StoryDetail, StoryPlace } from './data/story';
import { EARTH_RADIUS_KM } from './geo';
import type { NodeBuffer } from './nodeBuffer';

/** An outlet's name, else its link's host, so every article lands in a named group. */
export function outletName(article: StoryArticle): string {
  if (article.outlet !== null && article.outlet.trim() !== '') return article.outlet.trim();
  try {
    return new URL(article.url).hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown outlet';
  }
}

/**
 * The outlet behind the story's headline: ingest titles a story with its lead
 * write-up, so the article carrying that headline names it. Otherwise the
 * earliest dated article, the one that broke it.
 */
export function leadOutlet(detail: StoryDetail): string | null {
  const titled = detail.articles.find((article) => article.headline === detail.title);
  if (titled) return outletName(titled);
  let earliest: StoryArticle | null = null;
  for (const article of detail.articles) {
    if (article.publishedAtMs === null) continue;
    if (earliest === null || article.publishedAtMs < (earliest.publishedAtMs ?? Infinity)) {
      earliest = article;
    }
  }
  const lead = earliest ?? detail.articles[0];
  return lead ? outletName(lead) : null;
}

export interface OutletGroup {
  readonly outlet: string;
  readonly country: string | null;
  /** Newest first, undated last. */
  readonly articles: readonly StoryArticle[];
}

function newestFirst(a: StoryArticle, b: StoryArticle): number {
  return (b.publishedAtMs ?? -Infinity) - (a.publishedAtMs ?? -Infinity);
}

/** Every article under its outlet; outlets ordered by their newest article. */
export function groupByOutlet(articles: readonly StoryArticle[]): OutletGroup[] {
  const groups = new Map<string, StoryArticle[]>();
  for (const article of articles) {
    const name = outletName(article);
    const group = groups.get(name);
    if (group) group.push(article);
    else groups.set(name, [article]);
  }
  return [...groups]
    .map(([outlet, list]) => {
      const sorted = [...list].sort(newestFirst);
      return {
        outlet,
        country: sorted.find((article) => article.outletCountry !== null)?.outletCountry ?? null,
        articles: sorted,
      };
    })
    .sort(
      (a, b) =>
        newestFirst(a.articles[0] as StoryArticle, b.articles[0] as StoryArticle) ||
        a.outlet.localeCompare(b.outlet),
    );
}

export type PlaceConfidence = 'high' | 'medium' | 'low';

/**
 * Ingest scores a place as precision × agreement: a city named by every
 * report is 80, a region 55, a country 30, each scaled by the share of
 * reports naming it (workers/ingest/src/pipeline/signals.ts).
 */
export function placeConfidence(confidence: number | null): PlaceConfidence | null {
  if (confidence === null) return null;
  if (confidence >= 60) return 'high';
  if (confidence >= 35) return 'medium';
  return 'low';
}

const CONFIDENCE_WORDS: Readonly<Record<PlaceConfidence, string>> = {
  high: 'High confidence.',
  medium: 'Medium confidence: the reports name the area less precisely, or not all agree.',
  low: 'Low confidence: the reports disagree, or name only a region or country.',
};

/** "Why this location", in plain language: where the pin is, who put it there, and how sure. */
export function placeExplanation(place: StoryPlace): string {
  const where = place.name.trim() === '' ? 'this spot' : place.name.trim();
  const level = placeConfidence(place.confidence);
  switch (place.source) {
    case 'gdelt': {
      const lead = `Placed automatically: ${where} is the place these reports name most.`;
      return level === null ? lead : `${lead} ${CONFIDENCE_WORDS[level]}`;
    }
    case 'dateline':
      return `Placed from the reports' dateline: they were filed from ${where}.`;
    case 'manual':
      return `Placed by an editor at ${where}.`;
    case null:
      return `Pinned at ${where}. How this place was chosen was not recorded.`;
  }
}

const storyRows = new WeakMap<NodeBuffer, Map<number, number>>();

/**
 * The row holding story `id`, or -1. The index is built once per NodeBuffer,
 * which is replaced whole on every update and never mutated.
 */
export function rowOfStory(nodes: NodeBuffer, id: number): number {
  let index = storyRows.get(nodes);
  if (!index) {
    index = new Map();
    for (let row = 0; row < nodes.count; row++) index.set(nodes.ids[row] ?? 0, row);
    storyRows.set(nodes, index);
  }
  return index.get(id) ?? -1;
}

export interface NearbyStory {
  readonly row: number;
  /** Great-circle distance, km. */
  readonly km: number;
}

export interface NearbyOptions {
  readonly limit?: number;
  readonly maxKm?: number;
}

/** How many nearby stories the sheet lists, and how far it looks. */
export const NEARBY_LIMIT = 5;
export const NEARBY_MAX_KM = 1000;

/**
 * The stories nearest `row`, closest first, among those published by `nowSec`
 * (the displayed instant: the globe shows nothing later). Positions are unit
 * vectors, so the distance is R · atan2(|a × b|, a · b), which stays accurate
 * for stories a few hundred metres apart where acos would not.
 */
export function nearbyStories(
  nodes: NodeBuffer,
  row: number,
  nowSec: number,
  options: NearbyOptions = {},
): NearbyStory[] {
  const limit = options.limit ?? NEARBY_LIMIT;
  const maxKm = options.maxKm ?? NEARBY_MAX_KM;
  if (row < 0 || row >= nodes.count || limit <= 0) return [];
  const p = nodes.positions;
  const ax = p[row * 3] ?? 0;
  const ay = p[row * 3 + 1] ?? 0;
  const az = p[row * 3 + 2] ?? 0;
  const found: NearbyStory[] = [];
  for (let other = 0; other < nodes.count; other++) {
    if (other === row || nodes.epochSec + (nodes.publishedSec[other] ?? 0) > nowSec) continue;
    const bx = p[other * 3] ?? 0;
    const by = p[other * 3 + 1] ?? 0;
    const bz = p[other * 3 + 2] ?? 0;
    const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    const km = Math.atan2(cross, ax * bx + ay * by + az * bz) * EARTH_RADIUS_KM;
    if (km <= maxKm) found.push({ row: other, km });
  }
  // Ties (one city's stories share a point) go to the hotter story.
  found.sort((a, b) => a.km - b.km || (nodes.heat[b.row] ?? 0) - (nodes.heat[a.row] ?? 0));
  return found.slice(0, limit);
}
