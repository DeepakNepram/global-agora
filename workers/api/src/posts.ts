/**
 * Posting through the Worker (Prompt 4.4): the one place a post's local badge
 * can come from.
 *
 *   GET  /api/local-badge   {label}, or {label: null, reason}: what this
 *                           request's network would show, for the toggle
 *   POST /api/posts         a post, forwarded to PostgREST as its author, with
 *                           the region label when the body asks for the badge
 *
 * The post goes in with the reader's own token, so every policy, limit and
 * trigger applies; the Worker adds only the label, recomputed from this
 * request's network and never taken from the client, and the secret that
 * lets the database accept it (…_local_badge.sql). Nothing about the reader
 * or the post is logged.
 */

import type { Logger } from '../../shared/log.ts';
import { restBase } from '../../shared/supabase.ts';
import {
  regionLabel,
  type LocalBadgeReply,
  type NetworkPlace,
} from '../../../src/core/localBadge.ts';

import type { Fetch } from './db.ts';
import { corsHeaders, jsonError, jsonReply, preflight } from './http.ts';

export interface PostingConfig {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  /** Null when unset (or refused, below): no labels, so the toggle is off. */
  readonly regionLabelSecret: string | null;
}

export interface PostingDeps {
  /** Null when SUPABASE_URL or SUPABASE_ANON_KEY is missing. */
  readonly posting: PostingConfig | null;
  /** Cloudflare's city and country for this request, and nothing else from request.cf. */
  readonly network: NetworkPlace;
  readonly fetch: Fetch;
  readonly allowedOrigins: readonly string[];
}

/** The value in supabase/seeds/local-region-label.sql: public, so local only. */
export const LOCAL_REGION_LABEL_SECRET = 'local-only-region-label';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

/** Plenty for 500 characters of post and a URL; anything bigger is not a post. */
const MAX_BODY_BYTES = 16 * 1024;
const FORWARD_TIMEOUT_MS = 10_000;
/** What the author gets back: never mod_scores, which no client may read. */
const RETURNED = 'id,story_id,body,stance,kind,evidence_url,region_label,mod_state,created_at';

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function postingConfig(
  env: { readonly [key: string]: unknown },
  log: Logger,
): PostingConfig | null {
  const text = (key: string): string => {
    const value = env[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const supabaseUrl = text('SUPABASE_URL');
  const anonKey = text('SUPABASE_ANON_KEY');
  if (supabaseUrl === '' || anonKey === '') return null;
  let secret: string | null = text('REGION_LABEL_SECRET') || null;
  if (secret === LOCAL_REGION_LABEL_SECRET && !isLocal(supabaseUrl)) {
    log.error('posting.config', { problem: 'the local region label secret on a hosted project' });
    secret = null;
  }
  return { supabaseUrl, anonKey, regionLabelSecret: secret };
}

function localBadge(request: Request, deps: PostingDeps): Response {
  const cors = corsHeaders(request, deps.allowedOrigins);
  const label = regionLabel(deps.network);
  let reply: LocalBadgeReply;
  const secret = deps.posting?.regionLabelSecret ?? null;
  if (secret === null) reply = { label: null, reason: 'unavailable' };
  else reply = label === null ? { label: null, reason: 'no-city' } : { label };
  // Per network, per request: never stored, here or in any cache.
  return jsonReply(200, reply, { 'cache-control': 'private, no-store', ...cors });
}

function bearer(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

function base64Utf8(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type Draft = Readonly<Record<string, unknown>>;

/** The fields a client may send, as PostgREST takes them; null when malformed. */
function forwardable(draft: Draft): Record<string, unknown> | null {
  const { story_id, body, kind, evidence_url, stance, local_badge } = draft;
  if (typeof story_id !== 'string' || typeof body !== 'string' || typeof kind !== 'string') {
    return null;
  }
  if (evidence_url !== undefined && evidence_url !== null && typeof evidence_url !== 'string') {
    return null;
  }
  if (stance !== undefined && typeof stance !== 'string') return null;
  if (local_badge !== undefined && typeof local_badge !== 'boolean') return null;
  return {
    story_id,
    body,
    kind,
    ...(evidence_url === undefined ? {} : { evidence_url }),
    ...(stance === undefined ? {} : { stance }),
  };
}

async function readDraft(request: Request): Promise<Draft | 'too-big' | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return 'too-big';
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return 'too-big';
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Draft)
      : null;
  } catch {
    return null;
  }
}

async function submit(
  request: Request,
  deps: PostingDeps,
  posting: PostingConfig,
): Promise<Response> {
  const cors = corsHeaders(request, deps.allowedOrigins);
  const token = bearer(request.headers.get('authorization'));
  if (token === null) return jsonError(401, 'sign in to post', cors);
  const draft = await readDraft(request);
  if (draft === 'too-big') return jsonError(413, 'a post is at most 16 KB of JSON', cors);
  const fields = draft === null ? null : forwardable(draft);
  if (draft === null || fields === null) {
    return jsonError(400, 'expected story_id, body and kind (and evidence_url, stance)', cors);
  }

  const headers: Record<string, string> = {
    apikey: posting.anonKey,
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/vnd.pgrst.object+json',
    prefer: 'return=representation',
  };
  // Only when the author asked, for this post, and only from this request.
  const label =
    draft['local_badge'] === true && posting.regionLabelSecret !== null
      ? regionLabel(deps.network)
      : null;
  if (label !== null && posting.regionLabelSecret !== null) {
    headers['x-region-label'] = base64Utf8(label);
    headers['x-region-label-secret'] = posting.regionLabelSecret;
  }

  let upstream: Response;
  try {
    upstream = await deps.fetch(`${restBase(posting.supabaseUrl)}/posts?select=${RETURNED}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
  } catch {
    return jsonError(502, 'posting is unavailable right now', cors);
  }
  // PostgREST's own reply, so the app sees its codes: 429 with PT429's wait,
  // 403 for a closed discussion, 400 for a broken rule.
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...cors,
    },
  });
}

/** The posting routes' response, or null for any other path. */
export function routePosting(
  request: Request,
  pathname: string,
  deps: PostingDeps,
): Promise<Response> | null {
  const respond = (methods: string, handle: () => Promise<Response> | Response) => {
    if (request.method === 'OPTIONS') {
      return Promise.resolve(
        preflight(request, deps.allowedOrigins, methods, 'Authorization, Content-Type'),
      );
    }
    if (!methods.split(', ').includes(request.method)) {
      return Promise.resolve(jsonError(405, 'method not allowed', { allow: methods }));
    }
    return Promise.resolve(handle());
  };
  if (pathname === '/api/local-badge') {
    return respond('GET, OPTIONS', () => localBadge(request, deps));
  }
  if (pathname === '/api/posts') {
    return respond('POST, OPTIONS', () => {
      const { posting } = deps;
      if (posting === null) return jsonError(503, 'API not configured');
      return submit(request, deps, posting);
    });
  }
  return null;
}
