import { describe, expect, it } from 'vitest';

import type { FetchLike } from './nodes';
import { retryDelayMs, startNodesFeed, type NodesFeedOptions, type Timers } from './nodesFeed';
import { samplePayload } from './payload.fixture';

/** Timers the test fires by hand, in order. */
function manualTimers(): Timers & { pending: { ms: number; fire: () => void }[] } {
  const pending: { id: number; ms: number; fire: () => void }[] = [];
  let next = 0;
  return {
    pending,
    set(callback, ms) {
      const id = ++next;
      pending.push({ id, ms, fire: callback });
      return id;
    },
    clear(handle) {
      const at = pending.findIndex((timer) => timer.id === handle);
      if (at >= 0) pending.splice(at, 1);
    },
  };
}

const ok = (etag: string): Response =>
  new Response(JSON.stringify(samplePayload()), { headers: { etag } });

/** Resolves pending promise callbacks (the feed's awaited fetch). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function feedWith(responses: (() => Response)[]) {
  const timers = manualTimers();
  const events: string[] = [];
  const sentEtags: (string | undefined)[] = [];
  let call = 0;
  const fetch: FetchLike = async (_url, init) => {
    sentEtags.push((init?.headers as Record<string, string>)['if-none-match']);
    const respond = responses[Math.min(call++, responses.length - 1)];
    if (respond === undefined) throw new Error('no response');
    return respond();
  };
  const options: NodesFeedOptions = {
    baseUrl: '/api',
    hours: 24,
    refreshMs: 120_000,
    fetch,
    timers,
    onUpdate: (nodes, etag) => events.push(`update ${nodes.count} ${etag}`),
    onUnchanged: (etag) => events.push(`unchanged ${etag}`),
    onError: (_error, failures) => events.push(`error ${failures}`),
  };
  return { feed: startNodesFeed(options), timers, events, sentEtags };
}

describe('startNodesFeed', () => {
  it('loads at once, then re-checks conditionally on the refresh interval', async () => {
    const t = feedWith([() => ok('W/"a"'), () => new Response(null, { status: 304 })]);
    await settle();
    expect(t.events).toEqual(['update 3 W/"a"']);
    expect(t.timers.pending.map((p) => p.ms)).toEqual([120_000]);

    t.timers.pending.shift()?.fire();
    await settle();
    expect(t.sentEtags).toEqual([undefined, 'W/"a"']);
    expect(t.events).toEqual(['update 3 W/"a"', 'unchanged W/"a"']);
    t.feed.stop();
  });

  it('retries failures sooner, backing off, and recovers', async () => {
    const t = feedWith([
      () => new Response('down', { status: 503 }),
      () => new Response('down', { status: 503 }),
      () => ok('W/"b"'),
    ]);
    await settle();
    expect(t.timers.pending.map((p) => p.ms)).toEqual([5000]);
    t.timers.pending.shift()?.fire();
    await settle();
    expect(t.timers.pending.map((p) => p.ms)).toEqual([10_000]);
    t.timers.pending.shift()?.fire();
    await settle();
    expect(t.events).toEqual(['error 1', 'error 2', 'update 3 W/"b"']);
    expect(t.timers.pending.map((p) => p.ms)).toEqual([120_000]);
    t.feed.stop();
  });

  it('holds while paused and checks at once on resume', async () => {
    const t = feedWith([() => ok('W/"a"')]);
    await settle();
    t.feed.pause();
    expect(t.timers.pending).toHaveLength(0);
    t.feed.resume();
    await settle();
    expect(t.sentEtags).toHaveLength(2);
    expect(t.timers.pending).toHaveLength(1);
    t.feed.stop();
  });

  it('reports nothing after stop, even for a check in flight', async () => {
    const t = feedWith([() => ok('W/"a"')]);
    t.feed.stop();
    await settle();
    expect(t.events).toEqual([]);
    expect(t.timers.pending).toHaveLength(0);
  });
});

describe('retryDelayMs', () => {
  it('doubles from 5 s and never exceeds the refresh interval', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => retryDelayMs(n, 120_000))).toEqual([
      5000, 10_000, 20_000, 40_000, 80_000, 120_000,
    ]);
    expect(retryDelayMs(3, 15_000)).toBe(15_000);
  });
});
