/**
 * Posting (Prompt 4.4). A post goes to the API Worker's /api/posts, never
 * straight to the database, because only the Worker can attach the local
 * badge (localBadge.ts). The Worker forwards it as its author, so a refusal
 * is the database's own: the posting limits' 429 and its wait, 403 when the
 * reader may not post here, 400 for a broken rule.
 *
 * Prompt 4.5's composer is the caller; nothing loads this before then.
 */

// Explicit .ts: scripts/db/smoke.ts loads this under plain Node, which needs it.
import type { FetchLike } from './data/nodes.ts';
import { parseLocalBadgeReply, type LocalBadgeReply } from './localBadge.ts';
import { rateLimitWait } from './moderation.ts';

/** posts.kind's CHECK (tests/posting-sql.test.ts keeps them level). */
export const POST_KINDS = ['argument', 'eyewitness', 'evidence', 'expert'] as const;
export type PostKind = (typeof POST_KINDS)[number];
export type PostStance = 'a' | 'b' | 'neutral';
export type PostModState = 'pending' | 'ok' | 'hidden' | 'removed';

export interface PostDraft {
  readonly storyId: string;
  readonly body: string;
  readonly kind: PostKind;
  /** Required for evidence, and only for evidence (the database's rule). */
  readonly evidenceUrl: string | null;
  /** Show the local badge on this post. Off unless its author turns it on. */
  readonly localBadge: boolean;
}

export interface SubmittedPost {
  readonly id: string;
  readonly storyId: string;
  readonly body: string;
  /** The side its author took; the database fills it in. */
  readonly stance: PostStance;
  readonly kind: PostKind;
  readonly evidenceUrl: string | null;
  readonly regionLabel: string | null;
  /** Pending until moderation has read it. */
  readonly modState: PostModState;
  readonly createdAtMs: number;
  /** The badge was asked for, but the network had no city when it was posted. */
  readonly badgeDropped: boolean;
}

export type PostingErrorCode =
  'signed-out' | 'rate-limited' | 'not-allowed' | 'invalid' | 'unavailable' | 'network' | 'unknown';

// Plain fields, not parameter properties: scripts/db/smoke.ts runs this under
// Node's type stripping, which cannot compile those.
export class PostingError extends Error {
  override readonly name: string = 'PostingError';
  readonly code: PostingErrorCode;
  /** For rate-limited: how long until the next post may go. */
  readonly retryAfterSeconds: number | null;
  constructor(code: PostingErrorCode, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** What the composer and the toggle need. */
export interface PostingRemote {
  localBadge(): Promise<LocalBadgeReply>;
  submit(draft: PostDraft): Promise<SubmittedPost>;
}

function field(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** A refusal from the Worker or, through it, PostgREST, as a code the UI can explain. */
export function postingErrorFrom(status: number, body: unknown): PostingError {
  const message = field(body, 'message') ?? field(body, 'error') ?? `HTTP ${status}`;
  if (status === 429) {
    const wait = rateLimitWait({ code: field(body, 'code'), details: field(body, 'details') });
    return new PostingError('rate-limited', message, wait ?? 60);
  }
  if (status === 401) return new PostingError('signed-out', message);
  if (status === 403) return new PostingError('not-allowed', message);
  if (status === 400 || status === 409 || status === 413) {
    return new PostingError('invalid', message);
  }
  if (status === 502 || status === 503 || status === 504) {
    return new PostingError('unavailable', message);
  }
  return new PostingError('unknown', message);
}

function base(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

async function send(url: string, init: RequestInit, fetchFn: FetchLike): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    throw new PostingError('network', `network error: ${String(error)}`);
  }
}

async function json(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** What the local badge would say for a post sent from this network now. */
export async function fetchLocalBadge(
  apiBaseUrl: string,
  fetchFn: FetchLike,
): Promise<LocalBadgeReply> {
  const response = await send(
    `${base(apiBaseUrl)}/local-badge`,
    { cache: 'no-store', headers: { accept: 'application/json' } },
    fetchFn,
  );
  const body = await json(response);
  if (!response.ok) throw postingErrorFrom(response.status, body);
  const reply = parseLocalBadgeReply(body);
  if (reply === null) throw new PostingError('unknown', 'unexpected local badge reply');
  return reply;
}

const KINDS: ReadonlySet<string> = new Set(POST_KINDS);
const STANCES: ReadonlySet<string> = new Set(['a', 'b', 'neutral']);
const STATES: ReadonlySet<string> = new Set(['pending', 'ok', 'hidden', 'removed']);

/** The Worker's reply to a post, checked; askedForBadge says whether one was asked for. */
export function parseSubmittedPost(value: unknown, askedForBadge: boolean): SubmittedPost {
  const text = (key: string): string => {
    const found = field(value, key);
    if (found === undefined) throw new PostingError('unknown', `reply has no ${key}`);
    return found;
  };
  const optional = (key: string): string | null => field(value, key) ?? null;
  const [stance, kind, modState] = [text('stance'), text('kind'), text('mod_state')];
  const createdAtMs = Date.parse(text('created_at'));
  if (!STANCES.has(stance) || !KINDS.has(kind) || !STATES.has(modState)) {
    throw new PostingError('unknown', 'reply has an unknown stance, kind or state');
  }
  if (!Number.isFinite(createdAtMs)) throw new PostingError('unknown', 'reply has a bad time');
  const regionLabel = optional('region_label');
  return {
    id: text('id'),
    storyId: text('story_id'),
    body: text('body'),
    stance: stance as PostStance,
    kind: kind as PostKind,
    evidenceUrl: optional('evidence_url'),
    regionLabel,
    modState: modState as PostModState,
    createdAtMs,
    badgeDropped: askedForBadge && regionLabel === null,
  };
}

export interface SubmitPostOptions {
  /** AppConfig.apiBaseUrl, e.g. "/api". */
  readonly apiBaseUrl: string;
  /** The signed-in reader's access token: the post is theirs. */
  readonly token: string;
  readonly draft: PostDraft;
  readonly fetch: FetchLike;
}

/** Sends one post through the Worker. Throws a PostingError when it does not go in. */
export async function submitPost(options: SubmitPostOptions): Promise<SubmittedPost> {
  const { draft } = options;
  const response = await send(
    `${base(options.apiBaseUrl)}/posts`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${options.token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        story_id: draft.storyId,
        body: draft.body,
        kind: draft.kind,
        evidence_url: draft.evidenceUrl,
        local_badge: draft.localBadge,
      }),
    },
    options.fetch,
  );
  const body = await json(response);
  if (!response.ok) throw postingErrorFrom(response.status, body);
  return parseSubmittedPost(body, draft.localBadge);
}
