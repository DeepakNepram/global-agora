/**
 * Cloudflare Worker: the globe's payload and story reads.
 *
 * Vars (never the service key: this Worker reads public news, and posts only
 * as the signed-in reader, with their own token): SUPABASE_URL and
 * SUPABASE_ANON_KEY (the publishable key), plus the tuning listed in
 * src/config.ts. Secret: REGION_LABEL_SECRET, the same value as the database's
 * Vault entry region_label_secret, which lets a post carry its local badge
 * (Prompt 4.4). Analytics (Prompt 5.2): UMAMI_WEBSITE_ID, the site's public
 * id in Umami (unset, events are dropped), and the EVENT_LIMITER rate limit
 * binding. Needs nodejs_compat for node:zlib's Brotli.
 */

import { createLogger } from '../../shared/log.ts';

import { handleFetch } from './app.ts';
import { createEdgeStore, createMemoryStore, createSwrCache, type EdgeCache } from './cache.ts';
import { resolveApiConfig, type Vars } from './config.ts';
import { createAnonDb } from './db.ts';
import { eventsConfig, type RateLimiter } from './events.ts';
import { postingConfig } from './posts.ts';

interface Env extends Vars {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_ANON_KEY?: string;
  readonly REGION_LABEL_SECRET?: string;
  readonly UMAMI_WEBSITE_ID?: string;
  readonly UMAMI_ENDPOINT?: string;
  readonly EVENT_LIMITER?: RateLimiter;
}

/** The two of Cloudflare's request.cf properties this Worker reads. */
interface CfPlace {
  readonly city?: unknown;
  readonly country?: unknown;
}

/** The Cloudflare runtime objects this Worker touches (a subset of workers-types). */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// Module scope: kept by the isolate across requests.
const cache = createSwrCache();
/** One entry per window length a client asks for: a handful at most. */
const memory = createMemoryStore(8);

function edgeCache(): EdgeCache | null {
  const caches = (globalThis as { caches?: { default?: EdgeCache } }).caches;
  return caches?.default ?? null;
}

export default {
  fetch(request: Request & { cf?: CfPlace }, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_ANON_KEY;
    const edge = edgeCache();
    const edgeStores = edge === null ? [] : [createEdgeStore(edge, new URL(request.url).origin)];
    const log = createLogger({ worker: 'api', requestId: crypto.randomUUID() });
    // Of everything Cloudflare knows about this request, the city and the
    // country, and only for the local badge (CLAUDE.md #5).
    const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
    const network = { city: text(request.cf?.city), country: text(request.cf?.country) };
    return handleFetch(request, {
      config: resolveApiConfig(env),
      db: url && key ? createAnonDb(url, key, (input, init) => fetch(input, init)) : null,
      cache,
      nodeStores: [memory, ...edgeStores],
      storyStores: edgeStores,
      now: () => Date.now(),
      waitUntil: (promise) => ctx.waitUntil(promise),
      log,
      posting: postingConfig(env, log),
      network,
      fetch: (input, init) => fetch(input, init),
      events: eventsConfig(env, log),
      eventLimiter: env.EVENT_LIMITER ?? null,
    });
  },
};
