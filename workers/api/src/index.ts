/**
 * Cloudflare Worker: the globe's payload and story reads.
 *
 * Vars (never the service key; this Worker only reads public news):
 * SUPABASE_URL and SUPABASE_ANON_KEY (the publishable key), plus the tuning
 * listed in src/config.ts. Needs nodejs_compat for node:zlib's Brotli.
 */

import { createLogger } from '../../shared/log.ts';

import { handleFetch } from './app.ts';
import { createEdgeStore, createMemoryStore, createSwrCache, type EdgeCache } from './cache.ts';
import { resolveApiConfig, type Vars } from './config.ts';
import { createAnonDb } from './db.ts';

interface Env extends Vars {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_ANON_KEY?: string;
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
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_ANON_KEY;
    const edge = edgeCache();
    const edgeStores = edge === null ? [] : [createEdgeStore(edge, new URL(request.url).origin)];
    return handleFetch(request, {
      config: resolveApiConfig(env),
      db: url && key ? createAnonDb(url, key, (input, init) => fetch(input, init)) : null,
      cache,
      nodeStores: [memory, ...edgeStores],
      storyStores: edgeStores,
      now: () => Date.now(),
      waitUntil: (promise) => ctx.waitUntil(promise),
      log: createLogger({ worker: 'api', requestId: crypto.randomUUID() }),
    });
  },
};
