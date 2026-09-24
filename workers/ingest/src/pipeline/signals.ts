/**
 * A story's accumulated evidence (story_signals.state), and what the story
 * row is derived from it.
 *
 * Title, place and category are re-derived from all the evidence on every
 * update, because the first article alone often picks badly (a wire copy that
 * mentions Iran more than the White House). Once a story is queued for
 * discussion they freeze (ingest_apply enforces it too), so the admin and
 * readers see a stable story.
 */

import { NEWS_CATEGORIES } from '../../../../src/core/nodeBuffer.ts';
import type { Writeup } from '../dedup/cluster.ts';
import { fromHex, isNearDuplicate, toBigintString, toHex } from '../dedup/simhash.ts';
import type { IngestArticle } from '../normalize/article.ts';
import { precision, precisionConfidence, type Place } from '../normalize/location.ts';
import { categoryScores, pickCategory } from '../score/category.ts';
import { heatScore, type HeatConfig } from '../score/heat.ts';

export const STATE_VERSION = 1;
const MAX_WRITEUPS = 32;
const MAX_OUTLETS = 400;
const MAX_PLACES = 16;
const MAX_KEYS = 64;
const VELOCITY_WINDOW_SEC = 3600;
const MAX_SOURCE_COUNT = 32767;

export interface WriteupState {
  /** Simhash as 16 hex digits. */
  readonly h: string;
  /** Its headline. */
  readonly t: string;
  /** Outlets carrying it. */
  o: number;
  /** First seen, epoch seconds. */
  readonly s: number;
}

export interface PlaceVote {
  readonly n: string;
  readonly la: number;
  readonly lo: number;
  readonly c: string | null;
  readonly t: number;
  v: number;
}

export interface SignalState {
  v: typeof STATE_VERSION;
  /** Articles attached. */
  a: number;
  /** Distinct write-ups ever seen (the list below is capped, this is not). */
  w: number;
  writeups: WriteupState[];
  outlets: string[];
  countries: string[];
  /** [outlet, seenAt] for the velocity window. */
  recent: [string, number][];
  /** Event key -> number of write-ups carrying it. */
  keys: Record<string, number>;
  places: Record<string, PlaceVote>;
  /** Summed category scores, indexed like NEWS_CATEGORIES. */
  cats: number[];
  /** Sum and count of GDELT tone. */
  tone: [number, number];
}

export function emptyState(): SignalState {
  return {
    v: STATE_VERSION,
    a: 0,
    w: 0,
    writeups: [],
    outlets: [],
    countries: [],
    recent: [],
    keys: {},
    places: {},
    cats: NEWS_CATEGORIES.map(() => 0),
    tone: [0, 0],
  };
}

/** A stored state, or null if it is missing or from another version. */
export function readState(value: unknown): SignalState | null {
  if (typeof value !== 'object' || value === null) return null;
  const state = value as Partial<SignalState>;
  if (
    state.v !== STATE_VERSION ||
    !Array.isArray(state.writeups) ||
    !Array.isArray(state.outlets)
  ) {
    return null;
  }
  return value as SignalState;
}

function keepTop<T>(record: Record<string, T>, limit: number, score: (item: T) => number): void {
  const entries = Object.entries(record);
  if (entries.length <= limit) return;
  entries.sort(([ka, a], [kb, b]) => score(b) - score(a) || (ka < kb ? -1 : 1));
  for (const [key] of entries.slice(limit)) delete record[key];
}

function addPlace(state: SignalState, place: Place): void {
  const vote = state.places[place.key];
  if (vote !== undefined) vote.v++;
  else {
    state.places[place.key] = {
      n: place.name,
      la: place.lat,
      lo: place.lon,
      c: place.countryCode,
      t: place.type,
      v: 1,
    };
  }
}

/** Folds new write-ups (and their not-yet-stored articles) into the state. */
export function mergeWriteups(
  state: SignalState,
  writeups: readonly Writeup[],
  batchTime: number,
): void {
  for (const writeup of writeups) {
    const hex = toHex(writeup.hash);
    const newOutlets = writeup.articles.filter((a) => !state.outlets.includes(a.outlet)).length;
    const existing = state.writeups.find((w) => {
      const hash = fromHex(w.h);
      return hash !== null && isNearDuplicate(hash, writeup.hash);
    });
    if (existing !== undefined) existing.o += newOutlets;
    else {
      state.w++;
      const lead = writeup.articles[0];
      state.writeups.push({
        h: hex,
        t: lead?.headline ?? '',
        o: writeup.articles.length,
        s: lead?.seenAt ?? batchTime,
      });
    }

    for (const key of writeup.keys) state.keys[key] = (state.keys[key] ?? 0) + 1;
    for (const article of writeup.articles) addArticle(state, article);
  }

  state.writeups.sort((a, b) => b.o - a.o || a.s - b.s);
  state.writeups.length = Math.min(state.writeups.length, MAX_WRITEUPS);
  state.outlets.length = Math.min(state.outlets.length, MAX_OUTLETS);
  keepTop(state.keys, MAX_KEYS, (count) => count);
  keepTop(state.places, MAX_PLACES, (vote) => vote.v);
  state.recent = state.recent.filter(([, seen]) => seen > batchTime - VELOCITY_WINDOW_SEC);
}

function addArticle(state: SignalState, article: IngestArticle): void {
  state.a++;
  if (!state.outlets.includes(article.outlet)) state.outlets.push(article.outlet);
  if (article.outletCountry !== null && !state.countries.includes(article.outletCountry)) {
    state.countries.push(article.outletCountry);
  }
  state.recent.push([article.outlet, article.seenAt]);
  if (article.place !== null) addPlace(state, article.place);
  categoryScores(article.themes).forEach(
    (score, i) => (state.cats[i] = (state.cats[i] ?? 0) + score),
  );
  if (article.tone !== null) state.tone = [state.tone[0] + article.tone, state.tone[1] + 1];
}

/** The winning place: most votes, then the most precise, then a stable order. */
export function bestPlace(state: SignalState): { key: string; vote: PlaceVote } | null {
  let best: { key: string; vote: PlaceVote } | null = null;
  for (const [key, vote] of Object.entries(state.places)) {
    if (
      best === null ||
      vote.v > best.vote.v ||
      (vote.v === best.vote.v && precision(vote.t) > precision(best.vote.t)) ||
      (vote.v === best.vote.v && precision(vote.t) === precision(best.vote.t) && key < best.key)
    ) {
      best = { key, vote };
    }
  }
  return best;
}

export interface DerivedStory {
  readonly title: string;
  readonly titleHash: string;
  readonly category: number;
  readonly lat: number;
  readonly lon: number;
  readonly placeName: string;
  readonly placeConf: number;
  readonly countryCode: string | null;
  readonly heat: number;
  readonly sentiment: number;
  readonly sourceCount: number;
}

/** The story row as the evidence stands at `batchTime`; null without a place. */
export function deriveStory(
  state: SignalState,
  batchTime: number,
  heat: HeatConfig,
): DerivedStory | null {
  const place = bestPlace(state);
  const lead = state.writeups[0];
  if (place === null || lead === undefined) return null;

  const totalVotes = Object.values(state.places).reduce((sum, vote) => sum + vote.v, 0);
  const agreement = totalVotes > 0 ? place.vote.v / totalVotes : 0;
  const velocity = new Set(
    state.recent
      .filter(([, seen]) => seen > batchTime - VELOCITY_WINDOW_SEC)
      .map(([outlet]) => outlet),
  ).size;
  const [toneSum, toneCount] = state.tone;
  const sentiment = toneCount > 0 ? Math.round((toneSum / toneCount) * 10) : 0;

  return {
    title: lead.t,
    titleHash: toBigintString(fromHex(lead.h) ?? { hi: 0, lo: 0 }),
    category: pickCategory(state.cats, state.a),
    lat: place.vote.la,
    lon: place.vote.lo,
    placeName: place.vote.n,
    placeConf: Math.round(precisionConfidence(place.vote.t) * agreement),
    countryCode: place.vote.c,
    heat: heatScore(
      {
        writeups: state.w,
        outlets: state.outlets.length,
        countries: state.countries.length,
        velocity,
      },
      heat,
    ),
    sentiment: Math.max(-100, Math.min(100, sentiment)),
    sourceCount: Math.max(1, Math.min(MAX_SOURCE_COUNT, state.outlets.length)),
  };
}
