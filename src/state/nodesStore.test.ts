import { describe, expect, it } from 'vitest';

import { createNodeBuffer } from '@/core';

import { createNodesStore } from './nodesStore';

describe('nodesStore', () => {
  it('starts loading, and is ready once stories arrive', () => {
    let now = 1000;
    const store = createNodesStore(() => now);
    expect(store.getState().status).toBe('loading');

    const nodes = createNodeBuffer(3);
    store.getState().loaded(nodes, 'W/"a"');
    expect(store.getState()).toMatchObject({ nodes, etag: 'W/"a"', status: 'ready' });
    expect(store.getState().checkedAtMs).toBe(1000);

    now = 5000;
    store.getState().unchanged('W/"a"');
    expect(store.getState().nodes).toBe(nodes);
    expect(store.getState().checkedAtMs).toBe(5000);
  });

  it('is in error only while there is nothing to show', () => {
    const store = createNodesStore(() => 0);
    store.getState().failed(1);
    expect(store.getState()).toMatchObject({ status: 'error', failures: 1 });

    store.getState().loaded(createNodeBuffer(1), null);
    store.getState().failed(2);
    expect(store.getState()).toMatchObject({ status: 'ready', failures: 2 });
    store.getState().unchanged(null);
    expect(store.getState().failures).toBe(0);
  });
});
