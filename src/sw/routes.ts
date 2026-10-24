/**
 * What the service worker does with each request (Prompt 5.2). Pure, so the
 * rules are unit-tested; src/sw/sw.ts carries them out.
 *
 * - `precached`: this build's shell (the page, its entry script and styles,
 *   the reader's lazy chunks), cached at install. Cache first.
 * - `immutable`: any other hashed build file (the admin pages, the Supabase
 *   SDK). Fetched when first needed, then kept with this build's shell, so a
 *   signed-in reader who loaded the SDK online still has it offline.
 * - `shell`: a page navigation. Network first, so a new deploy shows at once;
 *   offline, this build's cached page.
 * - `static`: textures, place names and icons. Stale-while-revalidate: they
 *   change rarely and keep their names when they do.
 * - `saved`: the news API's reads (the stories, a story's details, the
 *   outlets). Network first, and each good reply is saved; offline, the saved
 *   copy answers, marked with SAVED_AT_HEADER (src/core/data/saved.ts) so the
 *   app can say how old it is. Story details are capped by count.
 * - `pass`: everything else, untouched: other origins (Supabase, Sentry,
 *   analytics), anything but GET, the API's other routes (posting, reports,
 *   the local badge), and the dev server's report routes.
 */

export type Route =
  | { readonly kind: 'precached' }
  | { readonly kind: 'immutable' }
  | { readonly kind: 'shell' }
  | { readonly kind: 'static' }
  | { readonly kind: 'saved'; readonly cache: string; readonly limit: number | null }
  | { readonly kind: 'pass' };

/** The parts of a Request the rules read. */
export interface RouteRequest {
  readonly method: string;
  readonly url: string;
  readonly mode: string;
}

/** Where the news API is: the page's origin and AppConfig.apiBaseUrl, resolved. */
export interface RouteContext {
  readonly origin: string;
  /** Absolute, without a trailing slash, e.g. "https://agora.example/api". */
  readonly apiBase: string;
  readonly precached: ReadonlySet<string>;
}

/** The stories and the outlets: one saved reply per URL, few URLs. */
export const NEWS_CACHE = 'agora-news-v1';
/** Story details, one per story opened. */
export const STORIES_CACHE = 'agora-stories-v1';
/** The story details kept for offline reading: the most recently opened. */
export const SAVED_STORY_LIMIT = 60;

/** This build's shell; any other `agora-shell-*` cache is an old build's and is deleted on activate. */
export const SHELL_CACHE_PREFIX = 'agora-shell-';
/** Textures, place names, icons: kept across builds. */
export const STATIC_CACHE = 'agora-static-v1';

export function shellCacheName(version: string): string {
  return `${SHELL_CACHE_PREFIX}${version}`;
}

/** The page itself is precached as "/": Cloudflare Pages redirects /index.html there. */
export function precacheUrl(file: string): string {
  return file === 'index.html' ? '/' : `/${file}`;
}

const STATIC_PATH = /^\/(?:textures|data|icons)\/|^\/(?:favicon\.svg|manifest\.webmanifest)$/;
const STORY_PATH = /^\/story\/\d+$/;
const NEWS_PATH = /^\/(?:nodes|outlets(?:\/[^/]+)?)$/;

/** AppConfig.apiBaseUrl ("/api", or another origin's) as an absolute base. */
export function resolveApiBase(apiBaseUrl: string, origin: string): string {
  return new URL(apiBaseUrl, origin).href.replace(/\/+$/, '');
}

function savedRoute(url: URL, apiBase: string): Route | null {
  const base = new URL(apiBase);
  if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}/`)) return null;
  const path = url.pathname.slice(base.pathname.length);
  if (STORY_PATH.test(path)) {
    return { kind: 'saved', cache: STORIES_CACHE, limit: SAVED_STORY_LIMIT };
  }
  if (NEWS_PATH.test(path)) return { kind: 'saved', cache: NEWS_CACHE, limit: null };
  return null;
}

export function routeFor(request: RouteRequest, context: RouteContext): Route {
  const { origin, apiBase, precached } = context;
  if (request.method !== 'GET') return { kind: 'pass' };
  const url = new URL(request.url);
  const saved = savedRoute(url, apiBase);
  if (saved) return saved;
  if (url.origin !== origin) return { kind: 'pass' };
  if (request.mode === 'navigate') return { kind: 'shell' };
  if (precached.has(url.pathname)) return { kind: 'precached' };
  if (url.pathname.startsWith('/assets/')) return { kind: 'immutable' };
  if (STATIC_PATH.test(url.pathname)) return { kind: 'static' };
  return { kind: 'pass' };
}
