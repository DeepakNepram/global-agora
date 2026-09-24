/**
 * The API Worker's routes, free of Worker globals so tests can drive them.
 *
 *   GET|HEAD /api/nodes?hours=N     the columnar payload (docs/DATA_SCHEMA.md)
 *   GET|HEAD /api/story/:id         one story in full; :id is the payload's id or the UUID
 *   GET      /api/health            200 when configured
 *
 * Wrong methods get 405, anything else 404. Responses carry an ETag and
 * Cache-Control with stale-while-revalidate, and come from the SWR cache.
 */

import { errorFields, type Logger } from '../../shared/log.ts';

import type { EntryStore, SwrCache } from './cache.ts';
import { GoneError } from './cache.ts';
import type { ApiConfig } from './config.ts';
import type { ApiDb, StoryRef } from './db.ts';
import { buildNodes, buildStory } from './entries.ts';
import { corsHeaders, jsonError, jsonReply, preflight, serveEntry } from './http.ts';

export interface ApiDeps {
  readonly config: ApiConfig;
  /** Null when SUPABASE_URL or SUPABASE_ANON_KEY is missing. */
  readonly db: ApiDb | null;
  readonly cache: SwrCache;
  /** Checked in order; the payload uses memory then edge. */
  readonly nodeStores: readonly EntryStore[];
  /** Edge only: one entry per story would grow isolate memory without bound. */
  readonly storyStores: readonly EntryStore[];
  readonly now: () => number;
  readonly waitUntil: (promise: Promise<unknown>) => void;
  readonly log: Logger;
}

const STORY_PATH = /^\/api\/story\/([^/]+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEQ = /^[1-9]\d{0,15}$/;

function cacheControl(config: ApiConfig): string {
  return (
    `public, max-age=${config.ttlSeconds}, stale-while-revalidate=${config.staleSeconds}, ` +
    `stale-if-error=${config.staleIfErrorSeconds}`
  );
}

/** `hours` defaults to the longest window allowed; anything else must be a whole number in range. */
export function parseHours(raw: string | null, maxHours: number): number | null {
  if (raw === null) return maxHours;
  if (!/^\d{1,4}$/.test(raw)) return null;
  const hours = Number(raw);
  return hours >= 1 && hours <= maxHours ? hours : null;
}

export function parseStoryRef(raw: string): StoryRef | null {
  if (SEQ.test(raw) && Number.isSafeInteger(Number(raw))) return { seq: Number(raw) };
  if (UUID.test(raw)) return { id: raw.toLowerCase() };
  return null;
}

async function nodes(request: Request, url: URL, deps: ApiDeps, db: ApiDb): Promise<Response> {
  const { config } = deps;
  const hours = parseHours(url.searchParams.get('hours'), config.maxHours);
  if (hours === null)
    return jsonError(400, `hours must be a whole number from 1 to ${config.maxHours}`);

  const { entry, status } = await deps.cache.get({
    key: `nodes:v1:${hours}:${config.nodeLimit}`,
    stores: deps.nodeStores,
    build: (previous) =>
      buildNodes(
        { db, hours, limit: config.nodeLimit, brotliQuality: config.brotliQuality, now: deps.now },
        previous,
      ),
    timings: config,
    now: deps.now,
    waitUntil: deps.waitUntil,
    log: deps.log,
  });
  return serveEntry(request, entry, {
    cacheControl: cacheControl(config),
    status,
    extraHeaders: corsHeaders(request, config.allowedOrigins),
  });
}

async function story(request: Request, raw: string, deps: ApiDeps, db: ApiDb): Promise<Response> {
  const ref = parseStoryRef(raw);
  if (ref === null) return jsonError(400, 'story id must be a payload id or a UUID');
  const { config } = deps;
  const key = 'seq' in ref ? `story:v1:seq:${ref.seq}` : `story:v1:id:${ref.id}`;
  try {
    const { entry, status } = await deps.cache.get({
      key,
      stores: deps.storyStores,
      build: () => buildStory({ db, ref, articleLimit: config.storyArticleLimit, now: deps.now }),
      timings: config,
      now: deps.now,
      waitUntil: deps.waitUntil,
      log: deps.log,
    });
    return serveEntry(request, entry, {
      cacheControl: cacheControl(config),
      status,
      extraHeaders: corsHeaders(request, config.allowedOrigins),
    });
  } catch (error) {
    if (error instanceof GoneError) return jsonError(404, 'no such story');
    throw error;
  }
}

async function route(request: Request, url: URL, deps: ApiDeps): Promise<Response> {
  const { pathname } = url;
  const readable = request.method === 'GET' || request.method === 'HEAD';
  const known =
    pathname === '/api/nodes' || pathname === '/api/health' || STORY_PATH.test(pathname);
  if (!known) return jsonError(404, 'not found');
  if (request.method === 'OPTIONS') return preflight(request, deps.config.allowedOrigins);
  if (!readable) return jsonError(405, 'method not allowed', { allow: 'GET, HEAD, OPTIONS' });

  if (pathname === '/api/health') {
    return deps.db === null ? jsonError(503, 'API not configured') : jsonReply(200, { ok: true });
  }
  if (deps.db === null)
    return jsonError(503, 'API not configured: set SUPABASE_URL and SUPABASE_ANON_KEY');
  if (pathname === '/api/nodes') return nodes(request, url, deps, deps.db);
  return story(request, STORY_PATH.exec(pathname)?.[1] ?? '', deps, deps.db);
}

export async function handleFetch(request: Request, deps: ApiDeps): Promise<Response> {
  const url = new URL(request.url);
  const started = deps.now();
  let response: Response;
  try {
    response = await route(request, url, deps);
  } catch (error) {
    deps.log.error('request.error', { path: url.pathname, ...errorFields(error) });
    response = jsonError(502, 'news is unavailable right now');
  }
  deps.log.info('request', {
    method: request.method,
    path: url.pathname,
    query: url.search,
    status: response.status,
    cache: response.headers.get('x-cache'),
    ms: deps.now() - started,
  });
  return response;
}
