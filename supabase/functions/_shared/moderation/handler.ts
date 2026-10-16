/**
 * The moderate-post Edge Function (Prompt 4.3), runtime-free: the Deno entry
 * (supabase/functions/moderate-post/index.ts) only reads env and serves this.
 *
 * The database posts {post_id, body} with the hook secret when a post is
 * inserted (pg_net). Both models are asked in parallel; their replies go
 * back whole to public.record_moderation(), which decides. If either model
 * fails, nothing is recorded and the post stays pending for the retry sweep:
 * nothing is ever published unchecked.
 */
import { type ModerationEnv } from './env.ts';
import { checkGoogleText } from './googleText.ts';
import { checkOpenAI } from './openai.ts';
import { ProviderError } from './provider.ts';
import { moderationSignals } from './signals.ts';

/** Each model gets this long; pg_net waits 20 s for the whole request. */
export const MODEL_TIMEOUT_MS = 8000;

const POST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Compares without stopping at the first difference, so timing says nothing. */
export function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

function reply(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface ModerationRequest {
  readonly postId: string;
  readonly body: string;
}

async function readRequest(request: Request): Promise<ModerationRequest | null> {
  let json: { post_id?: unknown; body?: unknown };
  try {
    json = (await request.json()) as typeof json;
  } catch {
    return null;
  }
  const { post_id: postId, body } = json;
  // 500 code points is the posts CHECK; the slack covers nothing legitimate.
  if (typeof postId !== 'string' || !POST_ID.test(postId)) return null;
  if (typeof body !== 'string' || body.length === 0 || [...body].length > 500) return null;
  return { postId, body };
}

export async function handleModeration(
  request: Request,
  env: ModerationEnv | string,
  fetchImpl: typeof fetch,
  timeoutMs: number = MODEL_TIMEOUT_MS,
): Promise<Response> {
  if (typeof env === 'string') return reply(500, { error: env });
  if (request.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!sameSecret(request.headers.get('x-moderation-secret') ?? '', env.hookSecret)) {
    return reply(401, { error: 'unauthorised' });
  }
  const post = await readRequest(request);
  if (post === null) return reply(400, { error: 'expected {post_id, body}' });

  let scores: Readonly<Record<string, unknown>>;
  try {
    const [openai, google] = await Promise.all([
      checkOpenAI(post.body, {
        ...env.openai,
        fetch: fetchImpl,
        signal: AbortSignal.timeout(timeoutMs),
      }),
      checkGoogleText(post.body, {
        ...env.google,
        fetch: fetchImpl,
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    const standIns = (['openai', 'google'] as const).filter((model) => env[model].standIn);
    scores = {
      openai,
      google,
      signals: moderationSignals(openai, google),
      // Local only, and on the record: which replies were not a real model's.
      ...(standIns.length > 0 ? { stand_ins: standIns } : {}),
    };
  } catch (error) {
    // Never the post's text in a log or a reply: only which model failed.
    const reason = error instanceof ProviderError ? error.message : 'models failed';
    return reply(502, { error: reason });
  }

  const recorded = await fetchImpl(`${env.supabaseUrl}/rest/v1/rpc/record_moderation`, {
    method: 'POST',
    headers: {
      apikey: env.serviceRoleKey,
      authorization: `Bearer ${env.serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_post: post.postId, p_scores: scores }),
  }).catch(() => null);
  if (recorded === null || !recorded.ok) {
    return reply(502, { error: `recording failed: ${recorded?.status ?? 'network'}` });
  }
  const state = (await recorded.json().catch(() => null)) as unknown;
  return reply(200, { post_id: post.postId, state });
}
