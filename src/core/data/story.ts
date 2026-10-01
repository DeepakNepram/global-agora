import { NEWS_CATEGORIES, type NewsCategory } from '../nodeBuffer';

import type { FetchLike } from './nodes';

/**
 * One story in full, from GET /api/story/:id (docs/DATA_SCHEMA.md): what the
 * story sheet shows beyond the payload's headline and place. The JSON is
 * checked field by field before anything renders it, as the payload is; the
 * article URLs become links, so each must be http(s).
 */

export const PLACE_SOURCES = ['gdelt', 'dateline', 'manual'] as const;
export type PlaceSource = (typeof PLACE_SOURCES)[number];

export const DISCUSSION_STATES = ['none', 'queued', 'open', 'closed'] as const;
export type DiscussionState = (typeof DISCUSSION_STATES)[number];

export interface StoryArticle {
  /** The outlet's name (usually its domain); null when ingest had none. */
  readonly outlet: string | null;
  readonly outletCountry: string | null;
  readonly headline: string;
  /** http(s), checked here as well as by the database. */
  readonly url: string;
  readonly publishedAtMs: number | null;
  readonly snippet: string | null;
}

export interface StoryPlace {
  /** Empty when unknown. */
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  /** Where the coordinates came from; null when unrecorded. */
  readonly source: PlaceSource | null;
  /** 0–100: how sure the source was. */
  readonly confidence: number | null;
  readonly countryCode: string | null;
}

export interface StoryDiscussion {
  readonly state: DiscussionState;
  /** People with a visible post; null without a discussion. */
  readonly participants: number | null;
}

export interface StoryDetail {
  /** The payload id (stories.seq). */
  readonly id: number;
  readonly uuid: string;
  readonly title: string;
  /** Null for GDELT stories: ingest fetches no text. */
  readonly summary: string | null;
  readonly category: NewsCategory;
  readonly heat: number;
  readonly sourceCount: number;
  readonly publishedAtMs: number;
  readonly firstSeenAtMs: number;
  readonly place: StoryPlace;
  readonly discussion: StoryDiscussion;
  /** The true total; `articles` may be capped (API_STORY_ARTICLE_LIMIT). */
  readonly articleCount: number;
  /** Newest first. */
  readonly articles: readonly StoryArticle[];
}

export class StoryError extends Error {
  override readonly name: string = 'StoryError';
  constructor(
    message: string,
    /** HTTP status, or 0 when no response arrived (or it was malformed). */
    readonly status: number,
  ) {
    super(message);
  }
}

/** The story no longer exists: pruned after retention, or a link to one that never did. */
export class StoryGoneError extends StoryError {
  override readonly name = 'StoryGoneError';
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new StoryError(`story: ${message}`, 0);
}

function text(record: Json, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') fail(`${key} is not text`);
  return value;
}

function optionalText(record: Json, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') fail(`${key} is not text`);
  return value;
}

function number(record: Json, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${key} is not a number`);
  return value;
}

function optionalNumber(record: Json, key: string): number | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${key} is not a number`);
  return value;
}

function time(record: Json, key: string): number {
  const ms = Date.parse(text(record, key));
  if (!Number.isFinite(ms)) fail(`${key} is not a time`);
  return ms;
}

function optionalTime(record: Json, key: string): number | null {
  const raw = optionalText(record, key);
  if (raw === null) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) fail(`${key} is not a time`);
  return ms;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** The URL if it is an absolute http(s) link, else null: anything else must never become an href. */
export function safeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function parsePlace(value: unknown): StoryPlace {
  if (!isRecord(value)) fail('place is not an object');
  const source = value['source'];
  return {
    name: optionalText(value, 'name') ?? '',
    lat: number(value, 'lat'),
    lon: number(value, 'lon'),
    // An unknown source reads as unrecorded rather than failing the story.
    source: oneOf(source, PLACE_SOURCES) ? source : null,
    confidence: optionalNumber(value, 'confidence'),
    countryCode: optionalText(value, 'country_code'),
  };
}

function parseDiscussion(value: unknown): StoryDiscussion {
  if (!isRecord(value)) fail('discussion is not an object');
  const state = value['state'];
  if (!oneOf(state, DISCUSSION_STATES)) fail(`discussion.state ${String(state)} is unknown`);
  const participants = optionalNumber(value, 'participants');
  return {
    state,
    participants:
      participants !== null && Number.isInteger(participants) && participants >= 0
        ? participants
        : null,
  };
}

/** Articles whose URL is not http(s) are dropped, never rendered. */
function parseArticles(value: unknown): StoryArticle[] {
  if (!Array.isArray(value)) fail('articles is not a list');
  const articles: StoryArticle[] = [];
  for (const item of value) {
    if (!isRecord(item)) fail('an article is not an object');
    const url = safeHttpUrl(text(item, 'url'));
    if (url === null) continue;
    articles.push({
      outlet: optionalText(item, 'outlet'),
      outletCountry: optionalText(item, 'outlet_country'),
      headline: text(item, 'headline'),
      url,
      publishedAtMs: optionalTime(item, 'published_at'),
      snippet: optionalText(item, 'snippet'),
    });
  }
  return articles;
}

/** Checks the API's JSON and returns it typed. Throws StoryError naming the first problem. */
export function parseStory(value: unknown): StoryDetail {
  if (!isRecord(value)) fail('not an object');
  const id = number(value, 'seq');
  if (!Number.isInteger(id) || id < 1) fail('seq is not a story id');
  const category = value['category'];
  return {
    id,
    uuid: text(value, 'id'),
    title: text(value, 'title'),
    summary: optionalText(value, 'summary'),
    // The API names the category; an unknown name shows as world, like the payload.
    category: oneOf(category, NEWS_CATEGORIES) ? category : NEWS_CATEGORIES[0],
    heat: number(value, 'heat'),
    sourceCount: number(value, 'source_count'),
    publishedAtMs: time(value, 'published_at'),
    firstSeenAtMs: time(value, 'first_seen_at'),
    place: parsePlace(value['place']),
    discussion: parseDiscussion(value['discussion']),
    articleCount: number(value, 'article_count'),
    articles: parseArticles(value['articles']),
  };
}

export function storyUrl(baseUrl: string, id: number): string {
  return `${baseUrl.replace(/\/+$/, '')}/story/${id}`;
}

export function locationReportUrl(baseUrl: string, id: number): string {
  return `${storyUrl(baseUrl, id)}/location-report`;
}

export interface FetchStoryOptions {
  /** AppConfig.apiBaseUrl, e.g. "/api". */
  readonly baseUrl: string;
  /** The payload id. */
  readonly id: number;
  readonly fetch: FetchLike;
  readonly signal?: AbortSignal;
}

async function send(url: string, init: RequestInit, fetchFn: FetchLike): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new StoryError(`network error: ${String(error)}`, 0);
  }
}

/**
 * Loads one story. The browser's HTTP cache honours the API's max-age and
 * revalidates with its ETag, so re-asking for an open story (the participant
 * count) is a cache hit or a bodiless 304 until it changes.
 */
export async function fetchStory(options: FetchStoryOptions): Promise<StoryDetail> {
  const response = await send(
    storyUrl(options.baseUrl, options.id),
    {
      headers: { accept: 'application/json' },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
    options.fetch,
  );
  if (response.status === 404) throw new StoryGoneError('no such story', 404);
  if (!response.ok) throw new StoryError(`HTTP ${response.status}`, response.status);
  return parseStory(await response.json());
}

/** One anonymous "wrong location" report. Resolves false when the story is gone. */
export async function reportStoryLocation(
  options: Omit<FetchStoryOptions, 'signal'>,
): Promise<boolean> {
  const response = await send(
    locationReportUrl(options.baseUrl, options.id),
    { method: 'POST' },
    options.fetch,
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new StoryError(`HTTP ${response.status}`, response.status);
  return true;
}
