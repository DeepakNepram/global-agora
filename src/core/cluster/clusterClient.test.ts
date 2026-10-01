import { describe, expect, it } from 'vitest';

import type { Timers } from '../data/nodesFeed';
import type { NodeBuffer } from '../nodeBuffer';

import { FIXTURE_EPOCH_SEC, stack, storyBuffer } from './cluster.fixture';
import { clusterColumns, createClusterClient } from './clusterClient';
import { createClusterEngine, handleClusterRequest } from './engine';
import type { ClusterLayout } from './layout';
import type { ClusterLayoutRequest, ClusterReply, ClusterRequest } from './protocol';

const NOW = FIXTURE_EPOCH_SEC + 3600;
const DEBOUNCE_MS = 150;

/** Timers the test fires by hand. */
function manualTimers(): Timers & { pending: () => number; fireAll: () => void } {
  const pending = new Map<number, () => void>();
  let next = 0;
  return {
    set(callback) {
      pending.set(++next, callback);
      return next;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
    pending: () => pending.size,
    fireAll() {
      const due = [...pending.values()];
      pending.clear();
      for (const fire of due) fire();
    },
  };
}

function harness() {
  const timers = manualTimers();
  const posted: ClusterRequest[] = [];
  const layouts: { nodes: NodeBuffer; layout: ClusterLayout }[] = [];
  const errors: string[] = [];
  const client = createClusterClient({
    post: (request) => posted.push(request),
    timers,
    debounceMs: DEBOUNCE_MS,
    initialLevel: 2,
    onLayout: (nodes, layout) => layouts.push({ nodes, layout }),
    onError: (message) => errors.push(message),
  });
  const engine = createClusterEngine();
  /** Runs every posted request through a real engine and returns the replies, in order. */
  const answer = (): ClusterReply[] =>
    posted.splice(0).flatMap((request) => {
      const handled = handleClusterRequest(engine, request);
      return handled ? [handled.reply] : [];
    });
  const layoutRequests = (): ClusterLayoutRequest[] =>
    posted.filter((request): request is ClusterLayoutRequest => request.type === 'layout');
  return { client, timers, posted, layouts, errors, answer, layoutRequests };
}

describe('createClusterClient', () => {
  it('ships a payload and asks for its layout at once', () => {
    const t = harness();
    const nodes = storyBuffer(stack(3, 0, 0, 1));
    t.client.load(nodes, NOW);
    expect(t.posted.map((request) => request.type)).toEqual(['load', 'layout']);
    expect(t.layoutRequests()[0]).toMatchObject({ generation: 1, level: 2, nowSec: NOW });

    for (const reply of t.answer()) t.client.receive(reply);
    expect(t.layouts).toHaveLength(1);
    expect(t.layouts[0]?.nodes).toBe(nodes);
    expect(t.layouts[0]?.layout.counts[0]).toBe(3);
  });

  it('debounces level changes and asks only about the last one', () => {
    const t = harness();
    t.client.load(storyBuffer(stack(3, 0, 0, 1)), NOW);
    t.posted.length = 0;
    t.client.setLevel(3);
    t.client.setLevel(4);
    t.client.setLevel(5);
    expect(t.posted).toEqual([]);
    expect(t.timers.pending()).toBe(1);
    t.timers.fireAll();
    expect(t.layoutRequests().map((request) => request.level)).toEqual([5]);
  });

  it('does not ask again for a level crossed and uncrossed within the debounce', () => {
    const t = harness();
    t.client.load(storyBuffer(stack(3, 0, 0, 1)), NOW);
    t.posted.length = 0;
    t.client.setLevel(3);
    t.client.setLevel(2);
    t.timers.fireAll();
    expect(t.posted).toEqual([]);
  });

  it('asks about a new instant only when a story crossed its publish time', () => {
    const t = harness();
    const nodes = storyBuffer([...stack(2, 0, 0, 1), { id: 9, lat: 0, lon: 0, t: 7200 }]);
    t.client.load(nodes, NOW);
    t.posted.length = 0;
    t.client.setTime(NOW + 60);
    expect(t.timers.pending()).toBe(0);
    t.client.setTime(FIXTURE_EPOCH_SEC + 7200);
    t.timers.fireAll();
    expect(t.layoutRequests()).toHaveLength(1);
    expect(t.layoutRequests()[0]?.nowSec).toBe(FIXTURE_EPOCH_SEC + 7200);
  });

  it('opens and closes the clusters at once, not after the debounce', () => {
    const t = harness();
    t.client.load(storyBuffer(stack(3, 0, 0, 1)), NOW);
    t.posted.length = 0;
    t.client.setOpen(true);
    expect(t.layoutRequests()).toEqual([expect.objectContaining({ open: true, level: 2 })]);
    expect(t.timers.pending()).toBe(0);
    t.client.setOpen(true);
    expect(t.layoutRequests()).toHaveLength(1);
  });

  it('asks nothing while open, then closes at the instant the time came to rest', () => {
    const t = harness();
    const nodes = storyBuffer([...stack(2, 0, 0, 1), { id: 9, lat: 0, lon: 0, t: 7200 }]);
    t.client.load(nodes, NOW);
    t.client.setOpen(true);
    for (const reply of t.answer()) t.client.receive(reply);
    expect(t.layouts.at(-1)?.layout.open).toBe(true);
    for (let step = 1; step <= 10; step++) t.client.setTime(NOW + step * 1000);
    expect(t.posted).toEqual([]);
    expect(t.timers.pending()).toBe(0);

    t.client.setOpen(false);
    expect(t.layoutRequests()).toEqual([
      expect.objectContaining({ open: false, nowSec: NOW + 10_000 }),
    ]);
    for (const reply of t.answer()) t.client.receive(reply);
    // Published by then, so clustered with the stack it shares a place with.
    expect(t.layouts.at(-1)?.layout.visible).toBe(3);
  });

  it('keeps the open state for a level change made while open', () => {
    const t = harness();
    t.client.load(storyBuffer(stack(3, 0, 0, 1)), NOW);
    t.client.setOpen(true);
    t.posted.length = 0;
    t.client.setLevel(9);
    t.timers.fireAll();
    expect(t.layoutRequests()).toEqual([expect.objectContaining({ open: true, level: 9 })]);
  });

  it('uses only the answer to its latest question', () => {
    const t = harness();
    t.client.load(storyBuffer(stack(3, 0, 0, 1)), NOW);
    t.client.setLevel(9);
    t.timers.fireAll();
    const replies = t.answer();
    expect(replies).toHaveLength(2);
    for (const reply of replies) t.client.receive(reply);
    expect(t.layouts.map(({ layout }) => layout.level)).toEqual([9]);
  });

  it('drops a layout computed for an earlier payload', () => {
    const t = harness();
    t.client.load(storyBuffer(stack(3, 0, 0, 1)), NOW);
    const first = t.answer();
    t.client.load(storyBuffer(stack(5, 0, 0, 1)), NOW);
    for (const reply of first) t.client.receive(reply);
    expect(t.layouts).toEqual([]);
    for (const reply of t.answer()) t.client.receive(reply);
    expect(t.layouts.map(({ layout }) => layout.counts[0])).toEqual([5]);
  });

  it('reports an error only for the latest question', () => {
    const t = harness();
    t.client.load(storyBuffer(stack(2, 0, 0, 1)), NOW);
    t.client.receive({ type: 'error', request: 0, message: 'old' });
    t.client.receive({ type: 'error', request: 1, message: 'current' });
    expect(t.errors).toEqual(['current']);
  });

  it('stops asking once disposed', () => {
    const t = harness();
    t.client.load(storyBuffer(stack(2, 0, 0, 1)), NOW);
    t.client.setLevel(6);
    t.client.dispose();
    expect(t.timers.pending()).toBe(0);
    t.posted.length = 0;
    t.client.load(storyBuffer(stack(2, 0, 0, 1)), NOW);
    expect(t.posted).toEqual([]);
  });
});

describe('clusterColumns', () => {
  it('copies exactly the live rows, never the spare capacity', () => {
    const nodes = storyBuffer(stack(3, 0, 0, 1));
    const roomy = { ...nodes, ids: new Uint32Array(8) };
    roomy.ids.set(nodes.ids);
    const columns = clusterColumns(roomy);
    expect(columns.ids).toHaveLength(3);
    expect(columns.positions).toHaveLength(9);
    expect(columns.ids.buffer).not.toBe(roomy.ids.buffer);
  });
});
