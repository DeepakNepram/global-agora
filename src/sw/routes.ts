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
 * - `pass`: everything else, untouched: other origins (Supabase, Sentry,
 *   analytics), anything but GET, and the dev server's report routes.
 */

export type Route =
  | { readonly kind: 'precached' }
  | { readonly kind: 'immutable' }
  | { readonly kind: 'shell' }
  | { readonly kind: 'static' }
  | { readonly kind: 'pass' };

/** The parts of a Request the rules read. */
export interface RouteRequest {
  readonly method: string;
  readonly url: string;
  readonly mode: string;
}

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

export function routeFor(
  request: RouteRequest,
  origin: string,
  precached: ReadonlySet<string>,
): Route {
  if (request.method !== 'GET') return { kind: 'pass' };
  const url = new URL(request.url);
  if (url.origin !== origin) return { kind: 'pass' };
  if (request.mode === 'navigate') return { kind: 'shell' };
  if (precached.has(url.pathname)) return { kind: 'precached' };
  if (url.pathname.startsWith('/assets/')) return { kind: 'immutable' };
  if (STATIC_PATH.test(url.pathname)) return { kind: 'static' };
  return { kind: 'pass' };
}
