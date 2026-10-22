import { describe, expect, it, vi } from 'vitest';

import type { Suggester, SuggestOutcome } from './claude.ts';
import type { DebateEnv } from './env.ts';
import { handleSuggestDebate } from './handler.ts';

const STORY = '00000000-0000-4000-8000-0000000009f1';
const ENV: DebateEnv = { supabaseUrl: 'http://kong:8000', anonKey: 'anon', claude: null };
const BRIEF = { title: 'Hot story', summary: null, headlines: [] };

/** The database's answer to admin_story_brief(). */
function database(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function request(body: unknown, token: string | null = 'Bearer admin-jwt', method = 'POST') {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token !== null) headers.set('authorization', token);
  return new Request('http://functions/suggest-debate', {
    method,
    headers,
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

const answering = (outcome: SuggestOutcome): Suggester => vi.fn(async () => outcome);

describe('handleSuggestDebate', () => {
  it('answers the browser’s preflight', async () => {
    const response = await handleSuggestDebate(request(null, null, 'OPTIONS'), ENV, {
      fetch: database(200, BRIEF).fetchImpl,
      suggester: null,
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('reads the story as the caller, with their own token', async () => {
    const db = database(200, BRIEF);
    await handleSuggestDebate(request({ story_id: STORY }), ENV, {
      fetch: db.fetchImpl,
      suggester: null,
    });
    expect(db.calls[0]?.url).toBe('http://kong:8000/rest/v1/rpc/admin_story_brief');
    expect(new Headers(db.calls[0]?.init?.headers).get('authorization')).toBe('Bearer admin-jwt');
    expect(JSON.parse(String(db.calls[0]?.init?.body))).toEqual({ p_story: STORY });
  });

  it('refuses a non-admin before any model is called', async () => {
    const suggester = answering({ kind: 'declined' });
    const response = await handleSuggestDebate(request({ story_id: STORY }), ENV, {
      fetch: database(403, { code: '42501', message: 'moderators only' }).fetchImpl,
      suggester,
    });
    expect(response.status).toBe(403);
    expect(suggester).not.toHaveBeenCalled();
  });

  it('refuses without a token, a story id or POST', async () => {
    const deps = { fetch: database(200, BRIEF).fetchImpl, suggester: null };
    expect((await handleSuggestDebate(request({ story_id: STORY }, null), ENV, deps)).status).toBe(
      401,
    );
    expect((await handleSuggestDebate(request({ story_id: 'x' }), ENV, deps)).status).toBe(400);
    expect((await handleSuggestDebate(request(null, 'Bearer t', 'GET'), ENV, deps)).status).toBe(
      405,
    );
    expect((await handleSuggestDebate(request({}), 'not configured: X', deps)).status).toBe(500);
  });

  it('says when the story is gone or the database is unreachable', async () => {
    const gone = await handleSuggestDebate(request({ story_id: STORY }), ENV, {
      fetch: database(400, { code: 'P0002', message: 'no such story' }).fetchImpl,
      suggester: null,
    });
    expect(gone.status).toBe(404);
    const down = await handleSuggestDebate(request({ story_id: STORY }), ENV, {
      fetch: database(503, {}).fetchImpl,
      suggester: null,
    });
    expect(down.status).toBe(502);
  });

  it('answers with no suggestion when no key is set', async () => {
    const response = await handleSuggestDebate(request({ story_id: STORY }), ENV, {
      fetch: database(200, BRIEF).fetchImpl,
      suggester: null,
    });
    expect(await response.json()).toEqual({ suggestion: null, reason: 'not-configured' });
  });

  it('passes on a suggestion, or why there is none', async () => {
    const ok = await handleSuggestDebate(request({ story_id: STORY }), ENV, {
      fetch: database(200, BRIEF).fetchImpl,
      suggester: answering({
        kind: 'ok',
        suggestion: { prompt: 'Q?', sideA: 'Yes', sideB: 'No' },
        model: 'claude-opus-5-5',
      }),
    });
    expect(await ok.json()).toEqual({
      suggestion: { prompt: 'Q?', side_a: 'Yes', side_b: 'No' },
      reason: 'ok',
      model: 'claude-opus-5-5',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const declined = await handleSuggestDebate(request({ story_id: STORY }), ENV, {
      fetch: database(200, BRIEF).fetchImpl,
      suggester: answering({ kind: 'unavailable', reason: 'HTTP 529' }),
    });
    expect(declined.status).toBe(200);
    expect(await declined.json()).toEqual({ suggestion: null, reason: 'unavailable' });
    expect(warn).toHaveBeenCalledWith('suggest-debate: unavailable (HTTP 529)');
    warn.mockRestore();
  });
});
