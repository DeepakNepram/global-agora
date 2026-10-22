/**
 * The one call to Claude (Prompt 4.6): the Messages API over fetch, like
 * every Edge Function here (no packages: docs/DECISIONS.md), so the function
 * starts without downloading anything and Vitest runs the same code.
 *
 * Structured output holds the reply to SUGGESTION_SCHEMA. A safety decline
 * is retried server-side on the model Anthropic recommends for its category
 * (`fallbacks: "default"`); if the whole chain declines, the admin types.
 */
import type { StoryBrief } from './brief.ts';
import type { ClaudeAccess } from './env.ts';
import { briefMessage, SYSTEM_PROMPT } from './prompt.ts';
import { parseSuggestion, SUGGESTION_SCHEMA, type Suggestion } from './suggestion.ts';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';
/** `fallbacks: "default"` needs exactly this beta (the array form has its own). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Generous for a short reply with thinking; the page shows it is waiting. */
export const CLAUDE_TIMEOUT_MS = 45_000;
/** The reply is short, but thinking counts against this too: room, not a target. */
const MAX_TOKENS = 16_000;
/** Rate limits, overload and server errors are worth one more try; the admin is waiting. */
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const RETRY_WAIT_MAX_MS = 2_000;

export type SuggestOutcome =
  | { readonly kind: 'ok'; readonly suggestion: Suggestion; readonly model: string }
  /** Every model in the chain declined (stop_reason "refusal"). */
  | { readonly kind: 'declined' }
  /** An answer that does not fit (too long, the same side twice, cut off). */
  | { readonly kind: 'unusable' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type Suggester = (brief: StoryBrief) => Promise<SuggestOutcome>;

/** The parts of a Messages API reply this reads. */
export interface ClaudeReply {
  readonly model?: unknown;
  readonly stop_reason?: unknown;
  readonly content?: unknown;
}

/** What a reply amounts to. */
export function outcomeOf(reply: ClaudeReply): SuggestOutcome {
  if (reply.stop_reason === 'refusal') return { kind: 'declined' };
  if (reply.stop_reason !== 'end_turn' || !Array.isArray(reply.content)) {
    return { kind: 'unusable' };
  }
  const text = (reply.content as unknown[])
    .map((block) => {
      const { type, text } = (block ?? {}) as { type?: unknown; text?: unknown };
      return type === 'text' && typeof text === 'string' ? text : '';
    })
    .join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'unusable' };
  }
  const suggestion = parseSuggestion(json);
  if (suggestion === null) return { kind: 'unusable' };
  return { kind: 'ok', suggestion, model: typeof reply.model === 'string' ? reply.model : '' };
}

/** The request body: Opus 5.5 thinks adaptively by itself, so no `thinking` is sent. */
export function requestBody(access: ClaudeAccess, brief: StoryBrief): Record<string, unknown> {
  return {
    model: access.model,
    max_tokens: MAX_TOKENS,
    fallbacks: 'default',
    output_config: {
      effort: access.effort,
      format: { type: 'json_schema', schema: SUGGESTION_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: briefMessage(brief) }],
  };
}

/** The server's retry-after, capped: a long wait is no use to someone at the page. */
function retryWaitMs(response: Response): number {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, RETRY_WAIT_MAX_MS)
    : 500;
}

export function createClaudeSuggester(
  access: ClaudeAccess,
  fetchImpl: typeof fetch,
  timeoutMs: number = CLAUDE_TIMEOUT_MS,
): Suggester {
  const url = `${access.baseUrl ?? ANTHROPIC_BASE_URL}/v1/messages`;
  return async (brief) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': access.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': FALLBACK_BETA,
      },
      body: JSON.stringify(requestBody(access, brief)),
      signal,
    };
    try {
      let response = await fetchImpl(url, init);
      if (RETRYABLE.has(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, retryWaitMs(response)));
        response = await fetchImpl(url, init);
      }
      if (!response.ok) return { kind: 'unavailable', reason: `HTTP ${response.status}` };
      return outcomeOf((await response.json()) as ClaudeReply);
    } catch (error) {
      if (signal.aborted) return { kind: 'unavailable', reason: 'timeout' };
      return { kind: 'unavailable', reason: error instanceof Error ? error.name : 'network' };
    }
  };
}
