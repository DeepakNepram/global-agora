import { describe, expect, it } from 'vitest';

import { createLogger } from '../../shared/log.ts';
import { handleFetch, type ApiDeps } from '../src/app.ts';
import { createMemoryStore, createSwrCache } from '../src/cache.ts';
import { DEFAULT_API_CONFIG } from '../src/config.ts';
import { LOCAL_REGION_LABEL_SECRET, postingConfig, type PostingConfig } from '../src/posts.ts';

const POSTING: PostingConfig = {
  supabaseUrl: 'https://project.supabase.example',
  anonKey: 'sb_publishable_test',
  regionLabelSecret: 'worker-secret',
};
const BENGALURU = { city: 'Bengaluru', country: 'IN' };
const DRAFT = {
  story_id: '00000000-0000-4000-8000-000000000007',
  body: 'The port should reopen.',
  kind: 'argument',
};

interface Forwarded {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function setup(
  overrides: Partial<ApiDeps> = {},
  reply: () => Response = () => new Response('{"id":"p1","region_label":null}', { status: 201 }),
) {
  const forwarded: Forwarded[] = [];
  const lines: string[] = [];
  const deps: ApiDeps = {
    config: { ...DEFAULT_API_CONFIG, allowedOrigins: ['https://app.example'] },
    db: null,
    cache: createSwrCache(),
    nodeStores: [createMemoryStore(1)],
    storyStores: [],
    now: () => 0,
    waitUntil: () => undefined,
    log: createLogger({}, (line) => lines.push(line)),
    posting: POSTING,
    network: BENGALURU,
    events: null,
    eventLimiter: null,
    fetch: async (url, init) => {
      forwarded.push({
        url,
        headers: { ...(init?.headers as Record<string, string>) },
        body: JSON.parse(String(init?.body)) as unknown,
      });
      return reply();
    },
    ...overrides,
  };
  return { deps, forwarded, lines };
}

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request('https://globe.example/api/posts', {
    method: 'POST',
    headers: {
      authorization: 'Bearer reader-token',
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const fromBase64 = (text: string): string =>
  new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));

describe('GET /api/local-badge', () => {
  it("says what this request's network would show, and keeps it out of every cache", async () => {
    const { deps } = setup();
    const response = await handleFetch(new Request('https://globe.example/api/local-badge'), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ label: 'Bengaluru area, India' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('etag')).toBeNull();
  });

  it('says there is no city when Cloudflare has none, with no other source tried', async () => {
    const { deps, forwarded } = setup({ network: { city: null, country: 'IN' } });
    const response = await handleFetch(new Request('https://globe.example/api/local-badge'), deps);
    expect(await response.json()).toEqual({ label: null, reason: 'no-city' });
    expect(forwarded).toEqual([]);
  });

  it('is unavailable when the Worker cannot write labels', async () => {
    for (const posting of [null, { ...POSTING, regionLabelSecret: null }]) {
      const { deps } = setup({ posting });
      const response = await handleFetch(
        new Request('https://globe.example/api/local-badge'),
        deps,
      );
      expect(await response.json()).toEqual({ label: null, reason: 'unavailable' });
    }
  });

  it('takes GET only', async () => {
    const { deps } = setup();
    const response = await handleFetch(
      new Request('https://globe.example/api/local-badge', { method: 'POST' }),
      deps,
    );
    expect(response.status).toBe(405);
  });
});

describe('POST /api/posts', () => {
  it("forwards the post to PostgREST as its author, the reader's own token", async () => {
    const { deps, forwarded } = setup();
    const response = await handleFetch(post(DRAFT), deps);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'p1', region_label: null });
    expect(response.headers.get('cache-control')).toBe('no-store');
    const [sent] = forwarded;
    expect(sent?.url).toBe(
      'https://project.supabase.example/rest/v1/posts' +
        '?select=id,story_id,body,stance,kind,evidence_url,region_label,mod_state,created_at',
    );
    expect(sent?.headers).toMatchObject({
      apikey: 'sb_publishable_test',
      authorization: 'Bearer reader-token',
      prefer: 'return=representation',
    });
    expect(sent?.body).toEqual(DRAFT);
  });

  it('adds no label unless the author turned the badge on for this post', async () => {
    for (const draft of [DRAFT, { ...DRAFT, local_badge: false }]) {
      const { deps, forwarded } = setup();
      await handleFetch(post(draft), deps);
      expect(Object.keys(forwarded[0]?.headers ?? {})).not.toContain('x-region-label');
      expect(Object.keys(forwarded[0]?.headers ?? {})).not.toContain('x-region-label-secret');
    }
  });

  it('adds the label from this request, with the secret, when the badge is on', async () => {
    const { deps, forwarded } = setup({ network: { city: 'São Paulo', country: 'BR' } });
    await handleFetch(post({ ...DRAFT, local_badge: true }), deps);
    const headers = forwarded[0]?.headers ?? {};
    expect(fromBase64(headers['x-region-label'] ?? '')).toBe('São Paulo area, Brazil');
    expect(headers['x-region-label-secret']).toBe('worker-secret');
    // The badge is a header for the database, never a column the client wrote.
    expect(forwarded[0]?.body).toEqual(DRAFT);
  });

  it('never forwards a label, or anything else, the client put in the body', async () => {
    const { deps, forwarded } = setup({ network: { city: null, country: null } });
    await handleFetch(
      post({
        ...DRAFT,
        local_badge: true,
        region_label: 'Paris area, France',
        author_id: 'someone-else',
        mod_state: 'ok',
      }),
      deps,
    );
    expect(forwarded[0]?.body).toEqual(DRAFT);
    expect(Object.keys(forwarded[0]?.headers ?? {})).not.toContain('x-region-label');
  });

  it('posts without a badge when the network has no city, or labels are off', async () => {
    for (const overrides of [
      { network: { city: null, country: 'IN' } },
      { posting: { ...POSTING, regionLabelSecret: null } },
    ]) {
      const { deps, forwarded } = setup(overrides);
      const response = await handleFetch(post({ ...DRAFT, local_badge: true }), deps);
      expect(response.status).toBe(201);
      expect(Object.keys(forwarded[0]?.headers ?? {})).not.toContain('x-region-label');
    }
  });

  it("passes PostgREST's refusals through, so the app sees the wait", async () => {
    const limit = {
      code: 'PT429',
      details: '{"retry_after_seconds":24,"limit":"spacing","posts_per_hour":5}',
      hint: null,
      message: 'Posting too fast: you can post again in 24 seconds.',
    };
    const { deps } = setup({}, () => new Response(JSON.stringify(limit), { status: 429 }));
    const response = await handleFetch(post(DRAFT), deps);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual(limit);
  });

  it('refuses without a token, before calling Supabase', async () => {
    const { deps, forwarded } = setup();
    const response = await handleFetch(post(DRAFT, { authorization: '' }), deps);
    expect(response.status).toBe(401);
    expect(forwarded).toEqual([]);
  });

  it('refuses a malformed or oversized body', async () => {
    const malformed = [
      'not json',
      '[1]',
      { ...DRAFT, body: 5 },
      { story_id: DRAFT.story_id, kind: 'argument' },
      { ...DRAFT, local_badge: 'yes' },
      { ...DRAFT, evidence_url: 3 },
    ];
    for (const body of malformed) {
      const { deps, forwarded } = setup();
      expect((await handleFetch(post(body), deps)).status).toBe(400);
      expect(forwarded).toEqual([]);
    }
    const { deps } = setup();
    const big = await handleFetch(post({ ...DRAFT, body: 'x'.repeat(17_000) }), deps);
    expect(big.status).toBe(413);
  });

  it('says so when Supabase cannot be reached, and when it is not configured', async () => {
    const down = setup({ fetch: () => Promise.reject(new TypeError('network')) });
    expect((await handleFetch(post(DRAFT), down.deps)).status).toBe(502);
    const unset = setup({ posting: null });
    expect((await handleFetch(post(DRAFT), unset.deps)).status).toBe(503);
  });

  it('logs neither the post nor the label', async () => {
    const { deps, lines } = setup();
    await handleFetch(post({ ...DRAFT, local_badge: true }), deps);
    const log = lines.join('\n');
    expect(log).not.toContain('Bengaluru');
    expect(log).not.toContain('port should reopen');
    expect(log).not.toContain('reader-token');
  });

  it('answers a cross-origin preflight from an allowed origin', async () => {
    const { deps } = setup();
    const response = await handleFetch(
      new Request('https://globe.example/api/posts', {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example' },
      }),
      deps,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe(
      'Authorization, Content-Type',
    );
  });
});

describe('postingConfig', () => {
  const log = createLogger({}, () => undefined);

  it('needs the project URL and the publishable key', () => {
    expect(postingConfig({}, log)).toBeNull();
    expect(postingConfig({ SUPABASE_URL: 'https://p.example' }, log)).toBeNull();
    expect(
      postingConfig({ SUPABASE_URL: 'https://p.example', SUPABASE_ANON_KEY: 'k' }, log),
    ).toEqual({ supabaseUrl: 'https://p.example', anonKey: 'k', regionLabelSecret: null });
  });

  it('takes the local secret only against the local stack', () => {
    const local = { SUPABASE_ANON_KEY: 'k', REGION_LABEL_SECRET: LOCAL_REGION_LABEL_SECRET };
    expect(
      postingConfig({ ...local, SUPABASE_URL: 'http://127.0.0.1:54321' }, log)?.regionLabelSecret,
    ).toBe(LOCAL_REGION_LABEL_SECRET);
    expect(
      postingConfig({ ...local, SUPABASE_URL: 'https://p.supabase.co' }, log)?.regionLabelSecret,
    ).toBeNull();
  });
});
