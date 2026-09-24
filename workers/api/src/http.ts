/**
 * Response helpers: conditional requests, content negotiation and CORS.
 */

import type { CacheEntry, CacheStatus } from './cache.ts';
import { acceptsBrotli, unbrotli } from './compress.ts';

/**
 * Weak comparison (RFC 9110 §13.1.2): W/"x" matches "x" and W/"x". The payload
 * is served in two encodings, so only weak comparison is meaningful.
 */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  const opaque = (tag: string): string => tag.trim().replace(/^W\//, '');
  const wanted = opaque(etag);
  return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || opaque(tag) === wanted);
}

/**
 * CORS for the configured origins only. The app is meant to be served from
 * the same origin as the API (Pages plus a Worker route), where none of this
 * applies; the allowlist exists for a split deploy.
 */
export function corsHeaders(
  request: Request,
  allowedOrigins: readonly string[],
): Record<string, string> {
  const origin = request.headers.get('origin');
  if (origin === null || !allowedOrigins.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-expose-headers': 'ETag, X-Cache',
    'access-control-max-age': '86400',
  };
}

export function preflight(request: Request, allowedOrigins: readonly string[]): Response {
  const cors = corsHeaders(request, allowedOrigins);
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      ...(Object.keys(cors).length > 0
        ? {
            'access-control-allow-methods': 'GET, HEAD, OPTIONS',
            'access-control-allow-headers': 'If-None-Match',
          }
        : {}),
      vary: 'Origin',
    },
  });
}

/** An uncached JSON reply: health checks and errors. */
export function jsonReply(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function jsonError(
  status: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return jsonReply(status, { error: message }, headers);
}

export interface ServeOptions {
  readonly cacheControl: string;
  readonly status: CacheStatus;
  readonly extraHeaders: Record<string, string>;
}

/**
 * The response for a cached entry: 304 when the client already has it,
 * otherwise the stored Brotli bytes as they are, or identity for a client
 * without br, which Cloudflare then gzips itself.
 *
 * Brotli replies carry `no-transform`: Cloudflare's edge keeps an origin's br
 * for a client that accepts it, but no-transform is its documented guarantee
 * that nothing re-encodes the bytes (gzip would be 157 KB, over budget).
 * `encodeBody: 'manual'` stops the runtime compressing them a second time.
 */
export function serveEntry(request: Request, entry: CacheEntry, options: ServeOptions): Response {
  const brotliOk = entry.encoding === 'br' && acceptsBrotli(request.headers.get('accept-encoding'));
  const headers: Record<string, string> = {
    'cache-control': brotliOk ? `${options.cacheControl}, no-transform` : options.cacheControl,
    etag: entry.etag,
    vary: 'Accept-Encoding, Origin',
    'x-cache': options.status,
    ...options.extraHeaders,
  };
  if (etagMatches(request.headers.get('if-none-match'), entry.etag)) {
    return new Response(null, { status: 304, headers });
  }

  headers['content-type'] = entry.contentType;
  const body = entry.encoding === 'br' && !brotliOk ? unbrotli(entry.body) : entry.body;
  if (brotliOk) headers['content-encoding'] = 'br';
  const init = { status: 200, headers, ...(brotliOk ? { encodeBody: 'manual' } : {}) };
  return new Response(request.method === 'HEAD' ? null : body, init as ResponseInit);
}
