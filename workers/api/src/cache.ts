/**
 * Stale-while-revalidate over a list of stores, checked in order: the
 * isolate's memory, then Cloudflare's edge cache (the Cache API, per data
 * centre). The Cache API has no stale-while-revalidate of its own, so entries
 * carry the time they were last confirmed and this module decides:
 *
 *   age < ttl                  fresh: serve                              HIT
 *   age < ttl + stale          serve, rebuild in the background          STALE
 *   otherwise, or no entry     rebuild before replying                   MISS
 *   rebuild fails, age < ttl + staleIfError   serve the old entry        STALE
 *
 * A rebuild receives the previous entry, so a source that can tell nothing
 * changed (api_nodes' hash) only re-times it: no egress, no compression. One
 * rebuild per key runs at a time in an isolate.
 */

import { errorFields, type Logger } from '../../shared/log.ts';

export interface CacheEntry {
  /** The response body as stored: Brotli bytes, or identity. */
  readonly body: Uint8Array<ArrayBuffer>;
  readonly encoding: 'br' | 'identity';
  readonly contentType: string;
  readonly etag: string;
  /** The source's own version of this content, passed back on rebuild. */
  readonly sourceHash: string;
  /** When the source last confirmed this content, epoch ms. */
  readonly checkedAt: number;
}

export interface EntryStore {
  get(key: string): Promise<CacheEntry | null>;
  /** `keepSeconds`: how long the store may keep it (fresh plus every stale window). */
  put(key: string, entry: CacheEntry, keepSeconds: number): Promise<void>;
}

/** Thrown by a build when the thing no longer exists: never answered from stale. */
export class GoneError extends Error {
  override readonly name = 'GoneError';
}

export type CacheStatus = 'HIT' | 'STALE' | 'MISS';

export interface CacheTimings {
  readonly ttlSeconds: number;
  readonly staleSeconds: number;
  readonly staleIfErrorSeconds: number;
}

export interface Lookup {
  readonly key: string;
  readonly stores: readonly EntryStore[];
  /** Builds the current entry; `previous` lets it skip unchanged work. */
  readonly build: (previous: CacheEntry | null) => Promise<CacheEntry>;
  readonly timings: CacheTimings;
  readonly now: () => number;
  /** Keeps a background rebuild alive after the response (ctx.waitUntil). */
  readonly waitUntil: (promise: Promise<unknown>) => void;
  readonly log: Logger;
}

export interface SwrCache {
  get(lookup: Lookup): Promise<{ entry: CacheEntry; status: CacheStatus }>;
}

/** Create once per isolate (module scope): it holds the single-flight table. */
export function createSwrCache(): SwrCache {
  const inflight = new Map<string, Promise<CacheEntry>>();

  const rebuild = (lookup: Lookup, previous: CacheEntry | null): Promise<CacheEntry> => {
    const running = inflight.get(lookup.key);
    if (running !== undefined) return running;
    const { ttlSeconds, staleSeconds, staleIfErrorSeconds } = lookup.timings;
    const keepSeconds = ttlSeconds + Math.max(staleSeconds, staleIfErrorSeconds);
    const task = (async (): Promise<CacheEntry> => {
      const next = await lookup.build(previous);
      // Best effort: a store that cannot keep it costs a rebuild later, not this reply.
      await Promise.all(
        lookup.stores.map((store) =>
          store
            .put(lookup.key, next, keepSeconds)
            .catch((error: unknown) =>
              lookup.log.warn('cache.put_failed', { key: lookup.key, ...errorFields(error) }),
            ),
        ),
      );
      return next;
    })().finally(() => inflight.delete(lookup.key));
    inflight.set(lookup.key, task);
    return task;
  };

  async function find(lookup: Lookup): Promise<CacheEntry | null> {
    for (let i = 0; i < lookup.stores.length; i++) {
      const entry = await lookup.stores[i]?.get(lookup.key);
      if (entry) {
        // Copy a slower store's hit into the faster ones before it.
        const { ttlSeconds, staleSeconds } = lookup.timings;
        for (const faster of lookup.stores.slice(0, i)) {
          await faster.put(lookup.key, entry, ttlSeconds + staleSeconds);
        }
        return entry;
      }
    }
    return null;
  }

  return {
    async get(lookup) {
      const { ttlSeconds, staleSeconds, staleIfErrorSeconds } = lookup.timings;
      const entry = await find(lookup);
      const age = entry === null ? Infinity : lookup.now() - entry.checkedAt;

      if (entry !== null && age < ttlSeconds * 1000) return { entry, status: 'HIT' };

      if (entry !== null && age < (ttlSeconds + staleSeconds) * 1000) {
        lookup.waitUntil(
          rebuild(lookup, entry).catch((error: unknown) =>
            lookup.log.warn('cache.refresh_failed', { key: lookup.key, ...errorFields(error) }),
          ),
        );
        return { entry, status: 'STALE' };
      }

      try {
        return { entry: await rebuild(lookup, entry), status: 'MISS' };
      } catch (error) {
        const usable = entry !== null && age < (ttlSeconds + staleIfErrorSeconds) * 1000;
        if (!usable || error instanceof GoneError) throw error;
        lookup.log.warn('cache.serving_stale_after_error', {
          key: lookup.key,
          ageSeconds: Math.round(age / 1000),
          ...errorFields(error),
        });
        return { entry, status: 'STALE' };
      }
    },
  };
}

/** The isolate's memory. Bounded, oldest first out; meant for a handful of keys. */
export function createMemoryStore(maxEntries: number): EntryStore {
  const entries = new Map<string, CacheEntry>();
  return {
    async get(key) {
      return entries.get(key) ?? null;
    },
    async put(key, entry) {
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}

/** The part of Cloudflare's Cache API this module uses (caches.default). */
export interface EdgeCache {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
}

const ENTRY_HEADER = 'x-agora-entry';

/**
 * Cloudflare's edge cache for this data centre. Each entry is stored as an
 * opaque octet-stream with its metadata in a header, so the CDN never
 * re-encodes the Brotli bytes. Keys are URLs under the request's own origin.
 * The Cache API does nothing on *.workers.dev; there only memory caches.
 */
export function createEdgeStore(cache: EdgeCache, origin: string): EntryStore {
  const url = (key: string): string => `${origin}/__cache/${encodeURIComponent(key)}`;
  return {
    async get(key) {
      const response = await cache.match(url(key));
      if (response === undefined) return null;
      const meta = response.headers.get(ENTRY_HEADER);
      if (meta === null) return null;
      try {
        const { encoding, contentType, etag, sourceHash, checkedAt } = JSON.parse(meta) as Omit<
          CacheEntry,
          'body'
        >;
        const body = new Uint8Array(await response.arrayBuffer());
        return { body, encoding, contentType, etag, sourceHash, checkedAt };
      } catch {
        return null;
      }
    },
    async put(key, entry, keepSeconds) {
      const { body, ...meta } = entry;
      await cache.put(
        url(key),
        new Response(body, {
          headers: {
            'content-type': 'application/octet-stream',
            'cache-control': `public, max-age=${keepSeconds}`,
            [ENTRY_HEADER]: JSON.stringify(meta),
          },
        }),
      );
    },
  };
}
