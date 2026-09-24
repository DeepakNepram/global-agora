import { brotliDecompressSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { parseNodesPayload } from '../../../src/core/data/payload.ts';
import { NEWS_CATEGORIES } from '../../../src/core/nodeBuffer.ts';
import { createLogger } from '../../shared/log.ts';
import { handleFetch, parseHours, parseStoryRef, type ApiDeps } from '../src/app.ts';
import { createMemoryStore, createSwrCache } from '../src/cache.ts';
import { acceptsBrotli } from '../src/compress.ts';
import { DEFAULT_API_CONFIG, resolveApiConfig, type ApiConfig } from '../src/config.ts';
import { createAnonDb, DbError, type ApiDb, type StoryRef } from '../src/db.ts';
import { etagMatches } from '../src/http.ts';

/** Columns as api_nodes builds them (see supabase/migrations/…_api.sql). */
function columns(hours: number, heat = [200, 150]): unknown {
  return {
    generated_at: 1_790_000_000,
    window_hours: hours,
    nodes: {
      id: [7, 9],
      lonQ: [-23, 25_431],
      latQ: [18_756, 12_990],
      t: [60, 80_000],
      cat: [2, 3],
      heat,
      srcN: [12, 3],
      disc: [1, 0],
      hl: ['Vote nears in London', 'Shares slide in Tokyo'],
      pl: ['London, United Kingdom', 'Tokyo, Japan'],
    },
  };
}

const STORY = {
  id: '00000000-0000-4000-8000-000000000007',
  seq: 7,
  title: 'Vote nears in London',
  category: 2,
  place: { name: 'London, United Kingdom', source: 'gdelt', confidence: 80 },
  discussion: { state: 'open' },
  article_count: 1,
  articles: [{ outlet: 'a.example', headline: 'Vote nears', url: 'https://a.example/1' }],
};

/** A database whose data version the test controls, counting calls like api_nodes would see them. */
function fakeDb(state = { version: 'h1', heat: [200, 150] }) {
  const calls: { hours: number; known: string | null }[] = [];
  const db: ApiDb = {
    async nodes(hours, _limit, known) {
      calls.push({ hours, known });
      return known === state.version
        ? { hash: state.version }
        : { hash: state.version, payload: columns(hours, state.heat) };
    },
    async story(ref: StoryRef) {
      return ('seq' in ref ? ref.seq === 7 : ref.id === STORY.id) ? STORY : null;
    },
  };
  return { db, calls, state };
}

function deps(overrides: Partial<ApiDeps> = {}, config: Partial<ApiConfig> = {}) {
  const clock = { now: 1_000_000 };
  const background: Promise<unknown>[] = [];
  const lines: string[] = [];
  const d: ApiDeps = {
    config: { ...DEFAULT_API_CONFIG, ...config },
    db: fakeDb().db,
    cache: createSwrCache(),
    nodeStores: [createMemoryStore(4)],
    storyStores: [createMemoryStore(4)],
    now: () => clock.now,
    waitUntil: (promise) => background.push(promise),
    log: createLogger({}, (line) => lines.push(line)),
    ...overrides,
  };
  return { d, clock, background, lines };
}

const get = (path: string, headers: Record<string, string> = {}, method = 'GET'): Request =>
  new Request(`https://globe.example${path}`, { method, headers });
const BR = { 'accept-encoding': 'gzip, deflate, br' };

describe('GET /api/nodes', () => {
  it('serves the payload Brotli-compressed with its cache headers', async () => {
    const { d } = deps();
    const response = await handleFetch(get('/api/nodes?hours=24', BR), d);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe('br');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=60, stale-while-revalidate=900, stale-if-error=86400, no-transform',
    );
    expect(response.headers.get('etag')).toMatch(/^W\/"[0-9a-f]{32}"$/);
    expect(response.headers.get('vary')).toBe('Accept-Encoding, Origin');
    expect(response.headers.get('x-cache')).toBe('MISS');

    const text = brotliDecompressSync(new Uint8Array(await response.arrayBuffer())).toString();
    expect(
      text.startsWith('{"v":1,"generated_at":1790000000,"window_hours":24,"categories":'),
    ).toBe(true);
    const payload = parseNodesPayload(JSON.parse(text));
    expect(payload.categories).toEqual(NEWS_CATEGORIES);
    expect(payload.nodes.hl).toEqual(['Vote nears in London', 'Shares slide in Tokyo']);
  });

  it('answers If-None-Match with a bodiless 304', async () => {
    const { d } = deps();
    const first = await handleFetch(get('/api/nodes', BR), d);
    const etag = first.headers.get('etag') ?? '';
    const again = await handleFetch(get('/api/nodes', { ...BR, 'if-none-match': etag }), d);
    expect(again.status).toBe(304);
    expect(again.headers.get('etag')).toBe(etag);
    expect(await again.text()).toBe('');
    // A strong copy of the same tag matches too (weak comparison).
    const strong = etag.replace(/^W\//, '');
    expect((await handleFetch(get('/api/nodes', { 'if-none-match': strong }), d)).status).toBe(304);
  });

  it('sends identity JSON to a client without br', async () => {
    const { d } = deps();
    const response = await handleFetch(get('/api/nodes', { 'accept-encoding': 'gzip' }), d);
    expect(response.headers.get('content-encoding')).toBeNull();
    // Cloudflare may gzip this one, so it must not say no-transform.
    expect(response.headers.get('cache-control')).not.toContain('no-transform');
    expect(parseNodesPayload(await response.json()).nodes.id).toEqual([7, 9]);
  });

  it('answers HEAD with headers only', async () => {
    const { d } = deps();
    const response = await handleFetch(get('/api/nodes', BR, 'HEAD'), d);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).not.toBeNull();
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it('defaults hours to the longest window and refuses anything out of range', async () => {
    const fake = fakeDb();
    const { d } = deps({ db: fake.db });
    await handleFetch(get('/api/nodes'), d);
    expect(fake.calls[0]?.hours).toBe(24);
    for (const bad of ['0', '25', 'abc', '1.5', '-1', '']) {
      expect((await handleFetch(get(`/api/nodes?hours=${bad}`), d)).status).toBe(400);
    }
  });

  it('revalidates in the background, and re-times unchanged data without a payload', async () => {
    const fake = fakeDb();
    const { d, clock, background } = deps({ db: fake.db });
    const first = await handleFetch(get('/api/nodes', BR), d);
    clock.now += 30_000;
    expect((await handleFetch(get('/api/nodes', BR), d)).headers.get('x-cache')).toBe('HIT');
    clock.now += 31_000;
    const stale = await handleFetch(get('/api/nodes', BR), d);
    expect(stale.headers.get('x-cache')).toBe('STALE');
    await Promise.all(background);
    expect(fake.calls.map((c) => c.known)).toEqual([null, 'h1']);

    // New data: the next stale read rebuilds with a new ETag.
    fake.state.version = 'h2';
    fake.state.heat = [255, 150];
    clock.now += 61_000;
    await handleFetch(get('/api/nodes', BR), d);
    await Promise.all(background);
    const fresh = await handleFetch(get('/api/nodes', BR), d);
    expect(fresh.headers.get('x-cache')).toBe('HIT');
    expect(fresh.headers.get('etag')).not.toBe(first.headers.get('etag'));
  });

  it('turns a database failure with nothing cached into a 502', async () => {
    const failing: ApiDb = {
      nodes: async () => {
        throw new DbError('down');
      },
      story: async () => null,
    };
    const { d, lines } = deps({ db: failing });
    const response = await handleFetch(get('/api/nodes'), d);
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(lines.some((line) => line.includes('"request.error"'))).toBe(true);
  });

  it('refuses a malformed payload from the database', async () => {
    const broken: ApiDb = {
      nodes: async () => ({ hash: 'x', payload: { generated_at: 1, window_hours: 24, nodes: {} } }),
      story: async () => null,
    };
    expect((await handleFetch(get('/api/nodes'), deps({ db: broken }).d)).status).toBe(502);
  });
});

describe('GET /api/story/:id', () => {
  it('finds a story by payload id or UUID and names its category', async () => {
    const { d } = deps();
    for (const id of ['7', STORY.id]) {
      const response = await handleFetch(get(`/api/story/${id}`), d);
      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toMatch(/^W\//);
      const body = (await response.json()) as typeof STORY & { category: string };
      expect(body.category).toBe('politics');
      expect(body.articles).toHaveLength(1);
      expect(body.place.source).toBe('gdelt');
    }
  });

  it('is 404 for an unknown story and 400 for a malformed id', async () => {
    const { d } = deps();
    expect((await handleFetch(get('/api/story/8'), d)).status).toBe(404);
    expect((await handleFetch(get('/api/story/abc'), d)).status).toBe(400);
    expect((await handleFetch(get('/api/story/0'), d)).status).toBe(400);
  });
});

describe('routing', () => {
  it('reports health, wrong methods and unknown paths', async () => {
    const { d } = deps();
    expect((await handleFetch(get('/api/health'), d)).status).toBe(200);
    expect((await handleFetch(get('/api/nodes', {}, 'POST'), d)).status).toBe(405);
    expect((await handleFetch(get('/api/other'), d)).status).toBe(404);
    const unconfigured = deps({ db: null }).d;
    expect((await handleFetch(get('/api/health'), unconfigured)).status).toBe(503);
    expect((await handleFetch(get('/api/nodes'), unconfigured)).status).toBe(503);
  });

  it('adds CORS headers for allowed origins only', async () => {
    const { d } = deps({}, { allowedOrigins: ['https://app.example'] });
    const allowed = await handleFetch(get('/api/nodes', { origin: 'https://app.example' }), d);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(allowed.headers.get('access-control-expose-headers')).toContain('ETag');
    const other = await handleFetch(get('/api/nodes', { origin: 'https://evil.example' }), d);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await handleFetch(
      get('/api/nodes', { origin: 'https://app.example' }, 'OPTIONS'),
      d,
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('GET');
  });
});

describe('parsing', () => {
  it('parses hours, story ids, Accept-Encoding and If-None-Match', () => {
    expect(parseHours(null, 24)).toBe(24);
    expect(parseHours('12', 24)).toBe(12);
    expect(parseHours('0012', 24)).toBe(12);
    expect(parseHours('25', 24)).toBeNull();
    expect(parseStoryRef('123')).toEqual({ seq: 123 });
    expect(parseStoryRef(STORY.id.toUpperCase())).toEqual({ id: STORY.id });
    expect(parseStoryRef('99999999999999999')).toBeNull();
    expect(acceptsBrotli('gzip, br;q=0.8')).toBe(true);
    expect(acceptsBrotli('br;q=0, gzip')).toBe(false);
    expect(acceptsBrotli(null)).toBe(false);
    expect(etagMatches('"x", W/"y"', 'W/"y"')).toBe(true);
    expect(etagMatches('*', 'W/"y"')).toBe(true);
    expect(etagMatches('"z"', 'W/"y"')).toBe(false);
  });

  it('reads tuning from vars, ignoring values out of range', () => {
    const config = resolveApiConfig({
      API_NODE_LIMIT: '2500',
      API_MAX_HOURS: '168',
      API_BROTLI_QUALITY: '99',
      API_ALLOWED_ORIGINS: 'https://a.example, not a url, http://localhost:5173',
    });
    expect(config.nodeLimit).toBe(2500);
    expect(config.maxHours).toBe(168);
    expect(config.brotliQuality).toBe(11);
    expect(config.allowedOrigins).toEqual(['https://a.example', 'http://localhost:5173']);
  });
});

describe('anon database client', () => {
  it('calls the RPCs with the publishable key and reads the unchanged answer', async () => {
    const sent: { url: string; init: RequestInit | undefined }[] = [];
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      sent.push({ url, init });
      return new Response(JSON.stringify({ hash: 'abc' }));
    };
    const db = createAnonDb('http://db.example/', 'sb_publishable_xyz', fetch);
    expect(await db.nodes(24, 3000, 'abc')).toEqual({ hash: 'abc' });
    expect(sent[0]?.url).toBe('http://db.example/rest/v1/rpc/api_nodes');
    const headers = sent[0]?.init?.headers as Record<string, string>;
    expect(headers['apikey']).toBe('sb_publishable_xyz');
    expect(headers['authorization']).toBeUndefined();
    expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({
      p_hours: 24,
      p_limit: 3000,
      p_known: 'abc',
    });
  });

  it('sends a legacy JWT as the bearer too, and raises on HTTP errors', async () => {
    let auth: string | undefined;
    const db = createAnonDb('http://db.example', 'eyJhbGciOi.legacy', async (_url, init) => {
      auth = (init?.headers as Record<string, string>)['authorization'];
      return new Response('{"message":"boom"}', { status: 500 });
    });
    await expect(db.story({ seq: 1 }, 1000)).rejects.toBeInstanceOf(DbError);
    expect(auth).toBe('Bearer eyJhbGciOi.legacy');
  });
});
