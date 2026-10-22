/**
 * The suggest-debate Edge Function (Prompt 4.6), runtime-free: the Deno
 * entry (supabase/functions/suggest-debate/index.ts) only reads env and
 * serves this.
 *
 * The admin console posts {story_id} with the admin's own token. The story's
 * brief is read as that caller, so the database refuses a non-admin before
 * any model is called. Model trouble is not an error for the page: it gets
 * {suggestion: null, reason} and the admin types the words.
 */
import { readBrief } from './brief.ts';
import type { Suggester } from './claude.ts';
import type { DebateEnv } from './env.ts';

const STORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The console calls from the site's origin. A bearer token, never a cookie,
 * carries the caller, so any origin may ask: without an admin's token the
 * answer is a refusal.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export type SuggestReason = 'ok' | 'not-configured' | 'declined' | 'unusable' | 'unavailable';

function reply(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

async function readStoryId(request: Request): Promise<string | null> {
  try {
    const { story_id: storyId } = (await request.json()) as { story_id?: unknown };
    return typeof storyId === 'string' && STORY_ID.test(storyId) ? storyId : null;
  } catch {
    return null;
  }
}

export interface DebateDeps {
  readonly fetch: typeof fetch;
  /** Null without a key: the function answers with no suggestion. */
  readonly suggester: Suggester | null;
}

export async function handleSuggestDebate(
  request: Request,
  env: DebateEnv | string,
  deps: DebateDeps,
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (typeof env === 'string') return reply(500, { error: env });
  if (request.method !== 'POST') return reply(405, { error: 'POST only' });
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'sign in first' });
  const storyId = await readStoryId(request);
  if (storyId === null) return reply(400, { error: 'expected {story_id}' });

  const brief = await readBrief(
    { supabaseUrl: env.supabaseUrl, anonKey: env.anonKey, fetch: deps.fetch },
    authorization,
    storyId,
  );
  if (brief.kind === 'forbidden') return reply(403, { error: 'moderators only' });
  if (brief.kind === 'missing') return reply(404, { error: 'no such story' });
  if (brief.kind === 'failed') {
    return reply(502, { error: `could not read the story: ${brief.reason}` });
  }

  if (deps.suggester === null) return reply(200, { suggestion: null, reason: 'not-configured' });
  const outcome = await deps.suggester(brief.brief);
  if (outcome.kind !== 'ok') {
    // The reason only; story text never reaches a log.
    console.warn(
      `suggest-debate: ${outcome.kind}${'reason' in outcome ? ` (${outcome.reason})` : ''}`,
    );
    return reply(200, { suggestion: null, reason: outcome.kind });
  }
  const { prompt, sideA, sideB } = outcome.suggestion;
  return reply(200, {
    suggestion: { prompt, side_a: sideA, side_b: sideB },
    reason: 'ok',
    model: outcome.model,
  });
}
