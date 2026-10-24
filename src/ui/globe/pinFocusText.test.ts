import { describe, expect, it } from 'vitest';

import { FIXTURE_EPOCH_SEC, storyBuffer } from '@/core/cluster/cluster.fixture';
import type { PinTarget } from '@/globe';

import { describePinTarget, spokenAgo } from './pinFocusText';

const nodes = storyBuffer([
  { id: 5, lat: 48.9, lon: 2.4, t: 0 },
  { id: 6, lat: 50.4, lon: 30.5, t: 0 },
]);
nodes.places[0] = 'Paris, France';
nodes.places[1] = 'Kyiv, Ukraine';
nodes.categories[0] = 2;
const now = (FIXTURE_EPOCH_SEC + 2 * 3600 + 120) * 1000;

describe('pin focus text', () => {
  it('reads a story: headline, category, place, age, position', () => {
    const target: PinTarget = {
      kind: 'story',
      row: 0,
      id: 5,
      x: 0,
      y: 0,
      category: 2,
      dimmed: false,
    };
    expect(describePinTarget(target, nodes, now, { index: 2, total: 41 })).toBe(
      'Story 5. Politics, Paris, France, 2 hours ago. 3 of 41.',
    );
  });

  it('reads an orb: size, main category, place, and what Enter does', () => {
    const target: PinTarget = {
      kind: 'cluster',
      row: 1,
      count: 12,
      at: { lat: 50, lon: 30 },
      level: 3,
      x: 0,
      y: 0,
      category: 1,
      dimmed: false,
    };
    expect(describePinTarget(target, nodes, now, { index: 0, total: 4 })).toBe(
      '12 stories, mostly Conflict, near Kyiv, Ukraine. Enter zooms in. 1 of 4.',
    );
  });

  it('says ages in words', () => {
    expect(spokenAgo(0, 30_000)).toBe('just now');
    expect(spokenAgo(0, 60_000)).toBe('1 minute ago');
    expect(spokenAgo(0, 3_600_000)).toBe('1 hour ago');
    expect(spokenAgo(0, 5 * 3_600_000)).toBe('5 hours ago');
  });
});
