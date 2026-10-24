/**
 * The service worker (Prompt 5.2): an offline shell, and the files it needs.
 * Which request gets which treatment is decided in routes.ts; this file only
 * carries it out. Bundled on its own into dist/sw.js after the app build
 * (scripts/vite/serviceWorker.ts), which fills in the constants below.
 *
 * Updates: a new build installs beside the old one and waits. The page offers
 * "Reload" (src/ui/platform/serviceWorker.ts), which posts `skip-waiting`; so
 * a reader is never switched to new code in the middle of a session.
 */

import { SAVED_AT_HEADER } from '../core/data/saved';

import {
  precacheUrl,
  resolveApiBase,
  routeFor,
  shellCacheName,
  SHELL_CACHE_PREFIX,
  STATIC_CACHE,
  type RouteContext,
} from './routes';

/** This build's shell files, relative to the site root (scripts/vite/serviceWorker.ts). */
declare const __AGORA_PRECACHE__: readonly string[];
/** A hash of those files' names: changes with any of them. */
declare const __AGORA_VERSION__: string;
/** The build's AppConfig.apiBaseUrl (VITE_API_BASE_URL, else "/api"). */
declare const __AGORA_API_BASE__: string;

/**
 * The slice of ServiceWorkerGlobalScope used here, declared locally: the
 * project compiles against the DOM lib (as src/ui/data/cluster.worker.ts does).
 */
interface SwExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface SwFetchEvent extends SwExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
interface SwScope {
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: SwExtendableEvent) => void,
  ): void;
  addEventListener(type: 'fetch', listener: (event: SwFetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  skipWaiting(): Promise<void>;
  readonly clients: { claim(): Promise<void> };
  readonly location: Location;
}

const scope = self as unknown as SwScope;
const SHELL = shellCacheName(__AGORA_VERSION__);
const CONTEXT: RouteContext = {
  origin: scope.location.origin,
  apiBase: resolveApiBase(__AGORA_API_BASE__, scope.location.origin),
  precached: new Set(__AGORA_PRECACHE__.map(precacheUrl)),
};

scope.addEventListener('install', (event) => {
  // `reload` skips the HTTP cache, so an install never keeps a stale copy.
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) =>
        cache.addAll([...CONTEXT.precached].map((url) => new Request(url, { cache: 'reload' }))),
      ),
  );
});

scope.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => scope.clients.claim()),
  );
});

scope.addEventListener('message', (event) => {
  if (
    typeof event.data === 'object' &&
    event.data !== null &&
    (event.data as { type?: unknown }).type === 'skip-waiting'
  ) {
    void scope.skipWaiting();
  }
});

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function shell(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch (error) {
    // The page from this build, whatever the path: the app routes itself.
    const page = await caches.match('/', { cacheName: SHELL });
    if (page) return page;
    throw error;
  }
}

async function staleWhileRevalidate(request: Request, event: SwFetchEvent): Promise<Response> {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  const fresh = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  if (hit) {
    // Refresh in the background; offline, the copy we have is the answer.
    event.waitUntil(fresh.catch(() => undefined));
    return hit;
  }
  return fresh;
}

/**
 * The copy kept for offline: the same body, marked as saved. Its value is the
 * reply's own Date header, so the worker never reads a clock; the body is
 * already decoded, so the encoding headers go.
 */
async function savedCopy(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set(SAVED_AT_HEADER, response.headers.get('date') ?? 'unknown');
  return new Response(await response.arrayBuffer(), { status: 200, headers });
}

async function save(
  cacheName: string,
  key: string,
  response: Response,
  limit: number | null,
): Promise<void> {
  const cache = await caches.open(cacheName);
  await cache.put(key, await savedCopy(response));
  if (limit === null) return;
  // Oldest first: a put moves its key to the end.
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((k) => cache.delete(k)));
}

async function networkThenSaved(
  request: Request,
  event: SwFetchEvent,
  cacheName: string,
  limit: number | null,
): Promise<Response> {
  // By URL alone: the feed's If-None-Match must not make a saved copy miss.
  const key = request.url;
  let response: Response;
  try {
    response = await fetch(request);
  } catch (error) {
    const saved = await caches.match(key, { cacheName, ignoreVary: true });
    if (saved) return saved;
    throw error;
  }
  if (response.status === 200) {
    event.waitUntil(save(cacheName, key, response.clone(), limit).catch(() => undefined));
  } else if (response.status === 404) {
    // A story that has gone is gone offline too.
    event.waitUntil(
      caches
        .open(cacheName)
        .then((cache) => cache.delete(key))
        .catch(() => undefined),
    );
  }
  return response;
}

scope.addEventListener('fetch', (event) => {
  const { request } = event;
  const route = routeFor(request, CONTEXT);
  switch (route.kind) {
    case 'precached':
    case 'immutable':
      event.respondWith(cacheFirst(request, SHELL));
      break;
    case 'shell':
      event.respondWith(shell(request));
      break;
    case 'static':
      event.respondWith(staleWhileRevalidate(request, event));
      break;
    case 'saved':
      event.respondWith(networkThenSaved(request, event, route.cache, route.limit));
      break;
    case 'pass':
      break;
  }
});
