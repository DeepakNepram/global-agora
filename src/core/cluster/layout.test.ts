import { describe, expect, it } from 'vitest';

import { FIXTURE_EPOCH_SEC, storyBuffer } from './cluster.fixture';
import { UNCLUSTERED_LEVEL } from './constants';
import { CLUSTER_ROLE, countVisible, unclusteredLayout } from './layout';

describe('unclusteredLayout', () => {
  const nodes = storyBuffer([
    { id: 5, lat: 10, lon: 20, category: 3 },
    { id: 6, lat: 10, lon: 20, category: 42 },
    { id: 7, lat: -5, lon: 60, t: 900 },
  ]);

  it('makes every published story its own pin at its own place', () => {
    const layout = unclusteredLayout(nodes, FIXTURE_EPOCH_SEC + 60, 4);
    expect(layout).toMatchObject({ generation: 4, level: UNCLUSTERED_LEVEL, count: 3, visible: 2 });
    expect(Array.from(layout.roles)).toEqual([
      CLUSTER_ROLE.pin,
      CLUSTER_ROLE.pin,
      CLUSTER_ROLE.hidden,
    ]);
    expect(Array.from(layout.groups)).toEqual([0, 1, -1]);
    expect(Array.from(layout.anchors)).toEqual(Array.from(nodes.positions.subarray(0, 9)));
  });

  it('maps a category the client does not know to world', () => {
    expect(Array.from(unclusteredLayout(nodes, FIXTURE_EPOCH_SEC).categories)).toEqual([3, 0, 0]);
  });
});

describe('countVisible', () => {
  it('counts stories published at or before the instant', () => {
    const nodes = storyBuffer([
      { id: 1, lat: 0, lon: 0, t: 0 },
      { id: 2, lat: 0, lon: 0, t: 100 },
      { id: 3, lat: 0, lon: 0, t: 101 },
    ]);
    expect(countVisible(nodes, FIXTURE_EPOCH_SEC - 1)).toBe(0);
    expect(countVisible(nodes, FIXTURE_EPOCH_SEC + 100)).toBe(2);
    expect(countVisible(nodes, FIXTURE_EPOCH_SEC + 101)).toBe(3);
  });
});
