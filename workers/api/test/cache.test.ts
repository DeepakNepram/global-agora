import { describe, expect, it } from 'vitest';

import { createLogger } from '../../shared/log.ts';
import {
  createEdgeStore,
  createMemoryStore,
  createSwrCache,
  GoneError,
  type CacheEntry,
  type EdgeCache,
  type Lookup,
} from '../src/cache.ts';

const TIMINGS = { ttlSeconds: 60, staleSeconds: 900, staleIfErrorSeconds: 86_400 };

function entry(version: string, checkedAt: number): CacheEntry {
  return {
    body: new TextEncoder().encode(`{"v":"${version}"}`),
    encoding: 'identity',
    contentType: 'application/json',
    etag: `W/"${version}"`,
    sourceHash: version,
    checkedAt,
  };
}

/** A lookup with a controllable clock and a build that counts its calls. */
function setup(builds: ((previous: CacheEntry | null, now: number) => Promise<CacheEntry>)[]) {
  const clock = { now: 1_000_000 };
  const background: Promise<unknown>[] = [];
  const logs: string[] = [];
  const stores = [createMemoryStore(4)];
  const calls: (CacheEntry | null)[] = [];
  const lookup: Lookup = {
    key: 'k',
    stores,
    timings: TIMINGS,
    now: () => clock.now,
    waitUntil: (promise) => background.push(promise),
    log: createLogger({}, (line) => logs.push(line)),
    build: (previous) => {
      calls.push(previous);
      const next = builds[Math.min(calls.length - 1, builds.length - 1)];
      if (next === undefined) throw new Error('no build');
      return next(previous, clock.now);
    },
  };
  return { clock, background, logs, stores, calls, lookup };
}

describe('SWR cache', () => {
  it('builds on a miss, then serves hits without building', async () => {
    const t = setup([async (_p, now) => entry('a', now)]);
    const cache = createSwrCache();
    expect((await cache.get(t.lookup)).status).toBe('MISS');
    t.clock.now += 59_000;
    const hit = await cache.get(t.lookup);
    expect(hit.status).toBe('HIT');
    expect(hit.entry.etag).toBe('W/"a"');
    expect(t.calls).toHaveLength(1);
  });

  it('serves stale while a background rebuild gets the previous entry', async () => {
    const t = setup([async (_p, now) => entry('a', now), async (_p, now) => entry('b', now)]);
    const cache = createSwrCache();
    await cache.get(t.lookup);
    t.clock.now += 61_000;
    const stale = await cache.get(t.lookup);
    expect(stale.status).toBe('STALE');
    expect(stale.entry.etag).toBe('W/"a"');
    expect(t.background).toHaveLength(1);
    await Promise.all(t.background);
    expect(t.calls[1]?.sourceHash).toBe('a');
    const after = await cache.get(t.lookup);
    expect(after).toMatchObject({ status: 'HIT', entry: { etag: 'W/"b"' } });
  });

  it('rebuilds before replying once past the stale window', async () => {
    const t = setup([async (_p, now) => entry('a', now), async (_p, now) => entry('b', now)]);
    const cache = createSwrCache();
    await cache.get(t.lookup);
    t.clock.now += (60 + 900) * 1000;
    expect(await cache.get(t.lookup)).toMatchObject({ status: 'MISS', entry: { etag: 'W/"b"' } });
  });

  it('runs one rebuild for concurrent misses', async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const t = setup([
      async (_p, now) => {
        await gate;
        return entry('a', now);
      },
    ]);
    const cache = createSwrCache();
    const both = Promise.all([cache.get(t.lookup), cache.get(t.lookup)]);
    release();
    const [one, two] = await both;
    expect(one.entry).toBe(two.entry);
    expect(t.calls).toHaveLength(1);
  });

  it('serves the old entry when a rebuild fails, within stale-if-error', async () => {
    const t = setup([
      async (_p, now) => entry('a', now),
      async () => {
        throw new Error('database down');
      },
    ]);
    const cache = createSwrCache();
    await cache.get(t.lookup);
    t.clock.now += 3600 * 1000;
    expect(await cache.get(t.lookup)).toMatchObject({ status: 'STALE', entry: { etag: 'W/"a"' } });
    expect(t.logs.some((line) => line.includes('cache.serving_stale_after_error'))).toBe(true);

    t.clock.now += 86_400 * 1000;
    await expect(cache.get(t.lookup)).rejects.toThrow('database down');
  });

  it('never answers a gone item from stale', async () => {
    const t = setup([
      async (_p, now) => entry('a', now),
      async () => {
        throw new GoneError('deleted');
      },
    ]);
    const cache = createSwrCache();
    await cache.get(t.lookup);
    t.clock.now += 3600 * 1000;
    await expect(cache.get(t.lookup)).rejects.toBeInstanceOf(GoneError);
  });

  it('copies a slower store hit into the faster store', async () => {
    const memory = createMemoryStore(4);
    const slow = createMemoryStore(4);
    await slow.put('k', entry('a', 1_000_000), 60);
    const t = setup([async () => entry('never', 0)]);
    const lookup = { ...t.lookup, stores: [memory, slow] };
    expect((await createSwrCache().get(lookup)).status).toBe('HIT');
    expect(await memory.get('k')).not.toBeNull();
    expect(t.calls).toHaveLength(0);
  });
});

describe('memory store', () => {
  it('drops the oldest entry past its bound', async () => {
    const store = createMemoryStore(2);
    await store.put('a', entry('a', 0), 60);
    await store.put('b', entry('b', 0), 60);
    await store.put('c', entry('c', 0), 60);
    expect(await store.get('a')).toBeNull();
    expect(await store.get('c')).not.toBeNull();
  });
});

describe('edge store', () => {
  it('round-trips an entry through an opaque Cache API response', async () => {
    const saved = new Map<string, Response>();
    const cache: EdgeCache = {
      match: async (url) => saved.get(url)?.clone(),
      put: async (url, response) => void saved.set(url, response),
    };
    const store = createEdgeStore(cache, 'https://globe.example');
    const original = { ...entry('a', 42), encoding: 'br' as const };
    await store.put('nodes:v1:24', original, 86_460);

    const [url, stored] = [...saved][0] ?? [];
    expect(url).toBe('https://globe.example/__cache/nodes%3Av1%3A24');
    expect(stored?.headers.get('content-type')).toBe('application/octet-stream');
    expect(stored?.headers.get('cache-control')).toBe('public, max-age=86460');
    expect(await store.get('nodes:v1:24')).toEqual(original);
    expect(await store.get('missing')).toBeNull();
  });
});
