import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { type ModerationEnv } from './env.ts';
import { handleModeration, sameSecret } from './handler.ts';

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'),
) as Record<string, { openai: { reply: unknown }; google: { reply: unknown } }>;

const POST_ID = '00000000-0000-4000-8000-000000000001';

const ENV: ModerationEnv = {
  hookSecret: 'hook',
  supabaseUrl: 'http://kong:8000',
  serviceRoleKey: 'service',
  openai: { apiKey: 'openai-key', standIn: false },
  google: { apiKey: 'google-key', standIn: false },
};

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** A fake network: each model replies from a fixture unless told to fail. */
function network(options: { openai?: number; google?: number | 'hang'; record?: number } = {}) {
  const calls: Call[] = [];
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/v1/moderations')) {
      return json(options.openai ?? 200, fixtures.threat?.openai.reply);
    }
    if (url.includes('moderateText')) {
      if (options.google === 'hang') {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }
      return json(options.google ?? 200, fixtures.threat?.google.reply);
    }
    if (url.endsWith('/rest/v1/rpc/record_moderation'))
      return json(options.record ?? 200, 'removed');
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function request(body: unknown, secret: string | null = 'hook', method = 'POST'): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (secret !== null) headers.set('x-moderation-secret', secret);
  return new Request('http://functions/moderate-post', {
    method,
    headers,
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

const valid = { post_id: POST_ID, body: 'I know where you live.' };

describe('handleModeration', () => {
  it('records both models’ whole replies and the signals, then answers with the state', async () => {
    const { calls, fetchImpl } = network();
    const response = await handleModeration(request(valid), ENV, fetchImpl);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ post_id: POST_ID, state: 'removed' });

    const record = calls.find((call) => call.url.endsWith('/rpc/record_moderation'));
    expect(record?.url).toBe('http://kong:8000/rest/v1/rpc/record_moderation');
    expect(new Headers(record?.init?.headers).get('authorization')).toBe('Bearer service');
    const sent = JSON.parse(String(record?.init?.body)) as {
      p_post: string;
      p_scores: Record<string, unknown>;
    };
    expect(sent.p_post).toBe(POST_ID);
    expect(sent.p_scores.openai).toEqual(fixtures.threat?.openai.reply);
    expect(sent.p_scores.google).toEqual(fixtures.threat?.google.reply);
    expect(sent.p_scores.signals).toEqual({
      flagged: ['harassment', 'harassment/threatening', 'violence'],
      toxicity: 0.92,
    });
  });

  it('sends the text to each model, with each key in a header', async () => {
    const { calls, fetchImpl } = network();
    await handleModeration(request(valid), ENV, fetchImpl);
    const openai = calls.find((call) => call.url === 'https://api.openai.com/v1/moderations');
    const google = calls.find(
      (call) => call.url === 'https://language.googleapis.com/v1/documents:moderateText',
    );
    expect(JSON.parse(String(openai?.init?.body))).toEqual({
      model: 'omni-moderation-latest',
      input: valid.body,
    });
    expect(new Headers(openai?.init?.headers).get('authorization')).toBe('Bearer openai-key');
    expect(JSON.parse(String(google?.init?.body))).toEqual({
      document: { type: 'PLAIN_TEXT', content: valid.body },
    });
    expect(new Headers(google?.init?.headers).get('x-goog-api-key')).toBe('google-key');
    expect(google?.url).not.toContain('key=');
  });

  it('sends a model without a key to the stand-in, and says so in the scores', async () => {
    const { calls, fetchImpl } = network();
    await handleModeration(
      request(valid),
      { ...ENV, google: { apiKey: 'stand-in', baseUrl: 'http://stand-in:1', standIn: true } },
      fetchImpl,
    );
    expect(calls.map((call) => call.url)).toContain('http://stand-in:1/v1/documents:moderateText');
    expect(calls.map((call) => call.url)).toContain('https://api.openai.com/v1/moderations');
    const record = calls.find((call) => call.url.endsWith('/rpc/record_moderation'));
    const sent = JSON.parse(String(record?.init?.body)) as { p_scores: Record<string, unknown> };
    expect(sent.p_scores.stand_ins).toEqual(['google']);
  });

  it('keeps stand-ins off the record when every model is real', async () => {
    const { calls, fetchImpl } = network();
    await handleModeration(request(valid), ENV, fetchImpl);
    const record = calls.find((call) => call.url.endsWith('/rpc/record_moderation'));
    expect(String(record?.init?.body)).not.toContain('stand_ins');
  });

  it.each([
    ['OpenAI is down', { openai: 503 }, 'openai: HTTP 503'],
    ['Google refuses the key', { google: 403 }, 'google: HTTP 403'],
  ])('records nothing when %s, so the post stays pending', async (_label, options, error) => {
    const { calls, fetchImpl } = network(options);
    const response = await handleModeration(request(valid), ENV, fetchImpl);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error });
    expect(calls.some((call) => call.url.includes('record_moderation'))).toBe(false);
  });

  it('gives up on a model that does not answer in time', async () => {
    const { calls, fetchImpl } = network({ google: 'hang' });
    const response = await handleModeration(request(valid), ENV, fetchImpl, 20);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'google: TimeoutError' });
    expect(calls.some((call) => call.url.includes('record_moderation'))).toBe(false);
  });

  it('says so when the database will not take the answer', async () => {
    const { fetchImpl } = network({ record: 401 });
    const response = await handleModeration(request(valid), ENV, fetchImpl);
    expect(response.status).toBe(502);
  });

  it.each([
    ['no secret', request(valid, null), 401],
    ['a wrong secret', request(valid, 'hooks'), 401],
    ['a GET', request(valid, 'hook', 'GET'), 405],
    ['a missing body', request({ post_id: POST_ID }), 400],
    ['a post id that is not one', request({ ...valid, post_id: '1; drop' }), 400],
    ['a body over 500 code points', request({ ...valid, body: '😀'.repeat(501) }), 400],
  ])('refuses %s without asking any model', async (_label, refused, status) => {
    const { calls, fetchImpl } = network();
    expect((await handleModeration(refused, ENV, fetchImpl)).status).toBe(status);
    expect(calls).toEqual([]);
  });

  it('answers 500 without configuration, asking no one', async () => {
    const { calls, fetchImpl } = network();
    const response = await handleModeration(request(valid), 'not configured: x', fetchImpl);
    expect(response.status).toBe(500);
    expect(calls).toEqual([]);
  });
});

describe('sameSecret', () => {
  it('matches only the same secret', () => {
    expect(sameSecret('hook', 'hook')).toBe(true);
    expect(sameSecret('hook', 'hoo')).toBe(false);
    expect(sameSecret('', 'hook')).toBe(false);
    expect(sameSecret('hooj', 'hook')).toBe(false);
  });
});
