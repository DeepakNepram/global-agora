import { describe, expect, it } from 'vitest';

import { FIXTURE_EPOCH_SEC, storyBuffer } from './cluster/cluster.fixture';
import { parsePlaces } from './data/places';
import { samplePlacesJson } from './data/places.fixture';
import { buildFeed, reasonText } from './feed';
import {
  cityTarget,
  countryTarget,
  followKey,
  followLabel,
  followTarget,
  isFollow,
  storyTarget,
  type Follow,
} from './follows';

const places = parsePlaces(samplePlacesJson());

function follow(
  kind: Follow['kind'],
  target: string,
  label: string,
  baseline: number | null = null,
): Follow {
  return { kind, target, label, baseline, createdAtMs: 0 };
}

describe('follow targets', () => {
  it('spell each kind one way', () => {
    expect(cityTarget(1159151609)).toBe('city:1159151609');
    expect(countryTarget('JP')).toBe('country:JP');
    expect(storyTarget(23904)).toBe('23904');
    expect(followKey({ kind: 'category', target: 'climate' })).toBe('category:climate');
  });

  it('read back what they point at, and nothing malformed', () => {
    expect(followTarget('place', 'city:12')).toEqual({ type: 'city', id: 12 });
    expect(followTarget('place', 'country:JP')).toEqual({ type: 'country', code: 'JP' });
    expect(followTarget('category', 'tech')).toEqual({ type: 'category', category: 'tech' });
    expect(followTarget('story', '7')).toEqual({ type: 'story', id: 7 });
    expect(followTarget('place', '51.5,-0.1')).toBeNull();
    expect(followTarget('place', 'country:jp')).toBeNull();
    expect(followTarget('category', 'gossip')).toBeNull();
    expect(followTarget('story', '0')).toBeNull();
  });

  it('validate a stored follow field by field', () => {
    expect(isFollow(follow('category', 'tech', 'Tech'))).toBe(true);
    expect(isFollow({ ...follow('category', 'tech', 'Tech'), label: '' })).toBe(false);
    expect(isFollow({ ...follow('story', '7', 'x'), baseline: -1 })).toBe(false);
    expect(isFollow({ ...follow('place', 'lat:1', 'x') })).toBe(false);
    expect(isFollow(null)).toBe(false);
  });

  it('keep labels within the column', () => {
    expect(followLabel('  Tokyo  ', 'x')).toBe('Tokyo');
    expect(followLabel('', 'A story')).toBe('A story');
    expect(followLabel('y'.repeat(400), 'x')).toHaveLength(300);
  });
});

describe('buildFeed', () => {
  // Rows in time order: Shinjuku (JP, climate), Kramatorsk (UA, conflict), Shizuoka (JP, politics).
  const nodes = storyBuffer([
    { id: 1, lat: 35.69, lon: 139.7, category: 5, t: 0 },
    { id: 2, lat: 48.72, lon: 37.56, category: 1, t: 60 },
    { id: 3, lat: 34.98, lon: 138.38, category: 2, t: 120 },
  ]);
  nodes.countryCodes.splice(0, 3, 'JP', 'UA', 'JP');
  nodes.sourceCounts.set([4, 30, 9]);

  it('lists the matching stories newest first, with why', () => {
    const feed = buildFeed(
      nodes,
      [
        follow('place', 'city:1159151609', 'Tokyo, Japan'),
        follow('category', 'conflict', 'Conflict'),
      ],
      places,
    );
    expect(feed.items.map((item) => [item.id, item.reasons])).toEqual([
      [2, ['Conflict']],
      [1, ['Tokyo, Japan']],
    ]);
    expect(feed.waitingForPlaces).toBe(false);
  });

  it('matches a city within 50 km only: Shizuoka, 145 km off, is not Tokyo', () => {
    const feed = buildFeed(nodes, [follow('place', 'city:1159151609', 'Tokyo, Japan')], places);
    expect(feed.items.map((item) => item.id)).toEqual([1]);
  });

  it('matches a country by its code', () => {
    const feed = buildFeed(nodes, [follow('place', 'country:JP', 'Japan')], places);
    expect(feed.items.map((item) => item.id)).toEqual([3, 1]);
  });

  it("gathers every reason once per story, and counts a followed story's new sources", () => {
    const feed = buildFeed(
      nodes,
      [
        follow('place', 'country:JP', 'Japan'),
        follow('category', 'climate', 'Climate'),
        follow('story', '1', 'Heatwave', 1),
      ],
      places,
    );
    const first = feed.items.find((item) => item.id === 1);
    expect(first?.reasons).toEqual(['Japan', 'Climate', 'this story']);
    expect(first?.sourcesGained).toBe(3);
    expect(feed.items.find((item) => item.id === 3)?.sourcesGained).toBeNull();
  });

  it('waits for the gazetteer before matching cities', () => {
    const feed = buildFeed(nodes, [follow('place', 'city:1159151609', 'Tokyo, Japan')], null);
    expect(feed).toEqual({ items: [], waitingForPlaces: true });
  });

  it('is empty with nothing followed', () => {
    expect(buildFeed(nodes, [], places).items).toEqual([]);
    expect(FIXTURE_EPOCH_SEC).toBeGreaterThan(0);
  });
});

describe('reasonText', () => {
  it('reads as a list', () => {
    expect(reasonText(['Tokyo'])).toBe('Tokyo');
    expect(reasonText(['Tokyo', 'Climate'])).toBe('Tokyo and Climate');
    expect(reasonText(['Tokyo', 'Climate', 'this story'])).toBe('Tokyo, Climate and this story');
  });
});
