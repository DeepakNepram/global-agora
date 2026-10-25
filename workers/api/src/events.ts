/**
 * Analytics through the Worker (Prompt 5.2):
 *
 *   POST /api/event   one of the six measures (src/core/analytics.ts)
 *
 * The event goes on to Umami Cloud, rebuilt here from nothing but its name
 * and its fields, so Umami never sees the reader's IP address (it would turn
 * it into a city) and nothing the app did not mean to send. Of the request's
 * headers, only the browser's name goes with it. Nothing is logged about the
 * reader. Unknown events, odd shapes and anything over a kilobyte are
 * refused; a burst from one connection is cut off by Cloudflare's rate
 * limiter, which keeps no record.
 */

import type { Logger } from '../../shared/log.ts';
import { parseAnalyticsEvent } from '../../../src/core/analytics.ts';

import type { Fetch } from './db.ts';
import { corsHeaders, jsonError, preflight } from './http.ts';

export interface EventsConfig {
  /** Umami's id for the site: public, but per deployment (UMAMI_WEBSITE_ID). */
  readonly websiteId: string;
  /** Umami's collection endpoint (UMAMI_ENDPOINT); Umami Cloud's by default. */
  readonly endpoint: string;
}

/** Cloudflare's rate limiting binding (wrangler.jsonc "ratelimits"). */
export interface RateLimiter {
  limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>;
}

export interface EventsDeps {
  /** Null when UMAMI_WEBSITE_ID is unset: events are accepted and dropped. */
  readonly events: EventsConfig | null;
  readonly limiter: RateLimiter | null;
  readonly fetch: Fetch;
  readonly allowedOrigins: readonly string[];
  readonly log: Logger;
  readonly waitUntil: (promise: Promise<unknown>) => void;
}

export const UMAMI_CLOUD_ENDPOINT = 'https://gateway.umami.is/api/send';
const MAX_BODY_BYTES = 1024;
const FORWARD_TIMEOUT_MS = 5000;
const UMAMI_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function eventsConfig(
  env: { readonly [key: string]: unknown },
  log: Logger,
): EventsConfig | null {
  const text = (key: string): string => {
    const value = env[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const websiteId = text('UMAMI_WEBSITE_ID');
  if (websiteId === '') return null;
  if (!UMAMI_ID.test(websiteId)) {
    log.error('events.config', { problem: 'UMAMI_WEBSITE_ID is not an id' });
    return null;
  }
  return { websiteId, endpoint: text('UMAMI_ENDPOINT') || UMAMI_CLOUD_ENDPOINT };
}

async function readEvent(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return null;
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

async function receive(request: Request, deps: EventsDeps): Promise<Response> {
  const cors = corsHeaders(request, deps.allowedOrigins);
  const event = parseAnalyticsEvent(await readEvent(request));
  if (event === null) return jsonError(400, 'not one of the six events', cors);

  if (deps.limiter !== null) {
    // The key lives only in Cloudflare's limiter, for its window.
    const key = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await deps.limiter.limit({ key });
    if (!success) return jsonError(429, 'too many events', cors);
  }

  const { events } = deps;
  if (events !== null) {
    const body = JSON.stringify({
      type: 'event',
      payload: {
        website: events.websiteId,
        hostname: new URL(request.url).hostname,
        url: '/',
        name: event.name,
        ...('data' in event ? { data: event.data } : {}),
      },
    });
    const forwarded = deps
      .fetch(events.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Umami drops events without a browser's name; it reads nothing else.
          'user-agent': request.headers.get('user-agent') ?? 'Mozilla/5.0',
        },
        body,
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      })
      .then((reply) => {
        if (!reply.ok) deps.log.error('events.forward', { status: reply.status });
      })
      .catch(() => deps.log.error('events.forward', { status: 0 }));
    // The reader's page does not wait for Umami.
    deps.waitUntil(forwarded);
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...cors } });
}

/** The event route's response, or null for any other path. */
export function routeEvents(
  request: Request,
  pathname: string,
  deps: EventsDeps,
): Promise<Response> | null {
  if (pathname !== '/api/event') return null;
  if (request.method === 'OPTIONS') {
    return Promise.resolve(
      preflight(request, deps.allowedOrigins, 'POST, OPTIONS', 'Content-Type'),
    );
  }
  if (request.method !== 'POST') {
    return Promise.resolve(jsonError(405, 'method not allowed', { allow: 'POST, OPTIONS' }));
  }
  return receive(request, deps);
}
