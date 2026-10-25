import { describe, expect, it } from 'vitest';

import { createLogger } from '../../shared/log.ts';
import { handleFetch, type ApiDeps } from '../src/app.ts';
import { createSwrCache } from '../src/cache.ts';
import { DEFAULT_API_CONFIG } from '../src/config.ts';
import { eventsConfig, UMAMI_CLOUD_ENDPOINT, type RateLimiter } from '../src/events.ts';

const SITE = '0b9f7a1e-5c2d-4e8f-9a3b-6d1c2e4f5a7b';

interface Sent {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function setup(limiter: RateLimiter | null = null, websiteId: string | null = SITE) {
  const sent: Sent[] = [];
  const background: Promise<unknown>[] = [];
  const deps: ApiDeps = {
    config: DEFAULT_API_CONFIG,
    db: null,
    cache: createSwrCache(),
    nodeStores: [],
    storyStores: [],
    now: () => 0,
    waitUntil: (promise) => background.push(promise),
    log: createLogger({}, () => undefined),
    posting: null,
    network: { city: 'Bengaluru', country: 'IN' },
    fetch: async (url, init) => {
      sent.push({
        url,
        headers: { ...(init?.headers as Record<string, string>) },
        body: JSON.parse(String(init?.body)) as unknown,
      });
      return new Response('{}');
    },
    events: websiteId === null ? null : { websiteId, endpoint: UMAMI_CLOUD_ENDPOINT },
    eventLimiter: limiter,
  };
  const post = async (body: unknown, headers: Record<string, string> = {}): Promise<Response> => {
    const response = await handleFetch(
      new Request('https://agora.example/api/event', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Mozilla/5.0 (Test)',
          'cf-connecting-ip': '203.0.113.7',
          'x-forwarded-for': '203.0.113.7',
          cookie: 'session=abc',
          referer: 'https://agora.example/?story=12',
          ...headers,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      deps,
    );
    await Promise.all(background);
    return response;
  };
  return { post, sent, deps };
}

describe('POST /api/event', () => {
  it('passes one of the six on to Umami, and nothing about the reader', async () => {
    const { post, sent } = setup();
    const response = await post({ name: 'session_end', data: { duration: '2-5m' } });
    expect(response.status).toBe(204);
    expect(sent).toEqual([
      {
        url: UMAMI_CLOUD_ENDPOINT,
        headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Test)' },
        body: {
          type: 'event',
          payload: {
            website: SITE,
            hostname: 'agora.example',
            url: '/',
            name: 'session_end',
            data: { duration: '2-5m' },
          },
        },
      },
    ]);
  });

  it('refuses what is not one of the six, and anything big', async () => {
    const { post, sent } = setup();
    expect((await post({ name: 'pageview' })).status).toBe(400);
    expect((await post({ name: 'story_opened', data: { story: 12 } })).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect((await post({ name: 'story_opened', pad: 'x'.repeat(2000) })).status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('stops a burst from one connection', async () => {
    const keys: string[] = [];
    let allowed = 2;
    const limiter: RateLimiter = {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: allowed-- > 0 };
      },
    };
    const { post, sent } = setup(limiter);
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await post({ name: 'story_opened' })).status);
    expect(statuses).toEqual([204, 204, 429]);
    expect(keys).toEqual(['203.0.113.7', '203.0.113.7', '203.0.113.7']);
    expect(sent).toHaveLength(2);
  });

  it('accepts and drops events when Umami is not configured', async () => {
    const { post, sent } = setup(null, null);
    expect((await post({ name: 'post_made' })).status).toBe(204);
    expect(sent).toEqual([]);
  });

  it('takes POST only', async () => {
    const { deps } = setup();
    const get = await handleFetch(new Request('https://agora.example/api/event'), deps);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, OPTIONS');
  });

  it('reads its settings, refusing a malformed id', () => {
    const log = createLogger({}, () => undefined);
    expect(eventsConfig({ UMAMI_WEBSITE_ID: SITE }, log)).toEqual({
      websiteId: SITE,
      endpoint: UMAMI_CLOUD_ENDPOINT,
    });
    expect(eventsConfig({}, log)).toBeNull();
    expect(eventsConfig({ UMAMI_WEBSITE_ID: 'not-an-id' }, log)).toBeNull();
  });
});
