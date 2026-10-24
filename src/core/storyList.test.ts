import { describe, expect, it } from 'vitest';

import { FIXTURE_EPOCH_SEC, storyBuffer } from './cluster/cluster.fixture';
import { NO_FILTER } from './filters';
import { listKey, listStories } from './storyList';

const HOUR = 3600;
// Five stories over five hours: ids 1–5, published 1 h apart.
const nodes = storyBuffer(
  [1, 2, 3, 4, 5].map((id) => ({ id, lat: 0, lon: 0, t: (id - 1) * HOUR })),
);
nodes.categories.set([0, 1, 1, 2, 3]);
nodes.heat.set([10, 200, 200, 50, 90]);
nodes.sourceCounts.set([1, 3, 7, 2, 4]);
const at = (hours: number): number => FIXTURE_EPOCH_SEC + hours * HOUR;
const ids = (rows: readonly number[]): number[] => rows.map((row) => nodes.ids[row] ?? -1);

describe('listStories', () => {
  it('lists what the globe draws at the displayed instant, newest first', () => {
    const result = listStories(nodes, at(2.5), NO_FILTER, 'newest');
    expect(ids(result.rows)).toEqual([3, 2, 1]);
    expect(result.published).toBe(3);
  });

  it('sorts the most covered first: heat, then outlets, then newer', () => {
    const result = listStories(nodes, at(10), NO_FILTER, 'covered');
    expect(ids(result.rows)).toEqual([3, 2, 5, 4, 1]);
  });

  it('applies the categories and the time window, and still counts what they leave out', () => {
    const conflict = listStories(
      nodes,
      at(10),
      { categories: ['conflict'], withinHours: null },
      'newest',
    );
    expect(ids(conflict.rows)).toEqual([3, 2]);
    expect(conflict.published).toBe(5);
    const recent = listStories(nodes, at(4), { categories: [], withinHours: 2 }, 'newest');
    expect(ids(recent.rows)).toEqual([5, 4, 3]);
  });
});

describe('listKey', () => {
  it('changes when a story is published or ages out of the window, not otherwise', () => {
    expect(listKey(nodes, at(1.2), NO_FILTER)).toBe(listKey(nodes, at(1.8), NO_FILTER));
    expect(listKey(nodes, at(1.8), NO_FILTER)).not.toBe(listKey(nodes, at(2.2), NO_FILTER));
    const window = { categories: [], withinHours: 1 };
    expect(listKey(nodes, at(10), window)).not.toBe(listKey(nodes, at(4.5), window));
    expect(listKey(null, 0, NO_FILTER)).toBe('');
  });
});
