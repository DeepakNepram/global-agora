/**
 * The service worker (Prompt 5.2): an offline shell, and the files it needs.
 * Which request gets which treatment is decided in routes.ts; this file only
 * carries it out. Bundled on its own into dist/sw.js after the app build
 * (scripts/vite/serviceWorker.ts), which fills in the two constants below.
 *
 * Updates: a new build installs beside the old one and waits. The page offers
 * "Reload" (src/ui/platform/serviceWorker.ts), which posts `skip-waiting`; so
 * a reader is never switched to new code in the middle of a session.
 */

import { precacheUrl, routeFor, shellCacheName, SHELL_CACHE_PREFIX, STATIC_CACHE } from './routes';

/** This build's shell files, relative to the site root (scripts/vite/serviceWorker.ts). */
declare const __AGORA_PRECACHE__: readonly string[];
/** A hash of those files' names: changes with any of them. */
declare const __AGORA_VERSION__: string;

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
const PRECACHED = new Set(__AGORA_PRECACHE__.map(precacheUrl));

scope.addEventListener('install', (event) => {
  // `reload` skips the HTTP cache, so an install never keeps a stale copy.
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) =>
        cache.addAll([...PRECACHED].map((url) => new Request(url, { cache: 'reload' }))),
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

scope.addEventListener('fetch', (event) => {
  const { request } = event;
  const route = routeFor(request, scope.location.origin, PRECACHED);
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
    case 'pass':
      break;
  }
});
