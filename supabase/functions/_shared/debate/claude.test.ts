import { describe, expect, it } from 'vitest';

import type { StoryBrief } from './brief.ts';
import { createClaudeSuggester, FALLBACK_BETA, outcomeOf } from './claude.ts';
import type { ClaudeAccess } from './env.ts';
import { SUGGESTION_SCHEMA } from './suggestion.ts';

const ACCESS: ClaudeAccess = {
  apiKey: 'test-key',
  standIn: false,
  model: 'claude-opus-5-5',
  effort: 'medium',
};
const BRIEF: StoryBrief = {
  title: 'Council votes on cars',
  summary: null,
  placeName: 'Paris',
  countryCode: 'FR',
  publishedAt: null,
  headlines: [],
};

function message(stopReason: string, text: string) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    usage: { input_tokens: 400, output_tokens: 60 },
  };
}

type Answer = { status: number; body: unknown } | 'hang';

/** Claude's API, faked: records each request and answers in turn. */
function api(...answers: Answer[]) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const answer = answers[Math.min(requests.length, answers.length) - 1];
    if (answer === 'hang' || answer === undefined) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json', 'retry-after': '0' },
    });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

const SUGGESTED = JSON.stringify({
  prompt: 'Should Paris ban cars?',
  side_a: 'Ban',
  side_b: 'Keep',
});

describe('createClaudeSuggester', () => {
  it('asks Opus 5.5 for structured output, with the server-side fallback', async () => {
    const claude = api({ status: 200, body: message('end_turn', SUGGESTED) });
    const outcome = await createClaudeSuggester(ACCESS, claude.fetchImpl)(BRIEF);
    expect(outcome).toEqual({
      kind: 'ok',
      suggestion: { prompt: 'Should Paris ban cars?', sideA: 'Ban', sideB: 'Keep' },
      model: 'claude-opus-5-5',
    });
    const [sent] = claude.requests;
    expect(sent?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent?.headers.get('x-api-key')).toBe('test-key');
    expect(sent?.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(sent?.headers.get('anthropic-beta')).toBe(FALLBACK_BETA);
    expect(FALLBACK_BETA).toBe('server-side-fallback-2026-07-01');
    expect(sent?.body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SUGGESTION_SCHEMA },
      },
    });
    expect(sent?.body).not.toHaveProperty('thinking');
    expect(JSON.stringify(sent?.body['messages'])).toContain('Council votes on cars');
  });

  it('goes to the stand-in when one is set', async () => {
    const claude = api({ status: 200, body: message('end_turn', SUGGESTED) });
    await createClaudeSuggester(
      { ...ACCESS, baseUrl: 'http://192.168.65.254:54398', standIn: true },
      claude.fetchImpl,
    )(BRIEF);
    expect(claude.requests[0]?.url).toBe('http://192.168.65.254:54398/v1/messages');
  });

  it('retries an overloaded or failing server once, then gives up', async () => {
    const overloaded = { status: 529, body: { type: 'error' } };
    const claude = api(overloaded, overloaded);
    expect(await createClaudeSuggester(ACCESS, claude.fetchImpl)(BRIEF)).toEqual({
      kind: 'unavailable',
      reason: 'HTTP 529',
    });
    expect(claude.requests).toHaveLength(2);
    const recovered = api(overloaded, { status: 200, body: message('end_turn', SUGGESTED) });
    expect((await createClaudeSuggester(ACCESS, recovered.fetchImpl)(BRIEF)).kind).toBe('ok');
  });

  it('does not retry a request Claude refused as bad, and stops waiting in time', async () => {
    const bad = api({ status: 400, body: { type: 'error' } });
    expect(await createClaudeSuggester(ACCESS, bad.fetchImpl)(BRIEF)).toEqual({
      kind: 'unavailable',
      reason: 'HTTP 400',
    });
    expect(bad.requests).toHaveLength(1);
    const slow = api('hang');
    expect(await createClaudeSuggester(ACCESS, slow.fetchImpl, 20)(BRIEF)).toEqual({
      kind: 'unavailable',
      reason: 'timeout',
    });
  });
});

describe('outcomeOf', () => {
  it('a declined chain, a cut-off reply and malformed JSON leave the admin to type', () => {
    expect(outcomeOf(message('refusal', ''))).toEqual({ kind: 'declined' });
    expect(outcomeOf(message('max_tokens', SUGGESTED))).toEqual({ kind: 'unusable' });
    expect(outcomeOf(message('end_turn', '{"prompt": '))).toEqual({ kind: 'unusable' });
    expect(
      outcomeOf(message('end_turn', JSON.stringify({ prompt: 'Q?', side_a: 'A', side_b: 'a' }))),
    ).toEqual({ kind: 'unusable' });
    expect(outcomeOf({ stop_reason: 'end_turn' })).toEqual({ kind: 'unusable' });
  });
});
