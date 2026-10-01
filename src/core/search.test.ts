import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FIXTURE_EPOCH_SEC, storyBuffer } from './cluster/cluster.fixture';
import { parsePlaces } from './data/places';
import { samplePlacesJson } from './data/places.fixture';
import { createNodeBuffer } from './nodeBuffer';
import { fillMockNodes } from './mockNodes';
import {
  indexOutlets,
  indexPlaces,
  indexStories,
  matchTier,
  normalizeSearch,
  resultCount,
  search,
  NO_RESULTS,
  type SearchSources,
} from './search';

const places = parsePlaces(samplePlacesJson());
const NOW = FIXTURE_EPOCH_SEC + 7200;

function storyNodes(): ReturnType<typeof storyBuffer> {
  const nodes = storyBuffer([
    { id: 11, lat: 35.69, lon: 139.75, category: 5, t: 0 },
    { id: 12, lat: 35.69, lon: 139.75, category: 2, t: 600 },
    // Far from every city in the sample gazetteer.
    { id: 13, lat: 48.72, lon: 37.56, category: 1, t: 1200 },
    // Published after the displayed instant.
    { id: 14, lat: 35.69, lon: 139.75, category: 5, t: 9000 },
  ]);
  nodes.headlines.splice(
    0,
    4,
    'Heatwave grips Tokyo as power demand peaks',
    'Tokyo vote count delayed',
    'Shelling reported near Kramatorsk',
    'Tokyo heat record falls',
  );
  nodes.places.splice(
    0,
    4,
    'Tokyo, Japan',
    'Tokyo, Japan',
    'Kramatorsk, Donetsk, Ukraine',
    'Tokyo, Japan',
  );
  return nodes;
}

function sources(): SearchSources {
  const nodes = storyNodes();
  return {
    places: indexPlaces(places),
    stories: indexStories(nodes, places),
    nodes,
    outlets: indexOutlets({
      v: 1,
      generated_at: 0,
      window_hours: 24,
      outlets: ['hindustantimes.com', 'Tasman Record', 'times.example'],
      n: [40, 12, 3],
    }),
  };
}

describe('normalizeSearch', () => {
  it('drops case, accents and punctuation', () => {
    expect(normalizeSearch('São Paulo')).toBe('sao paulo');
    expect(normalizeSearch('  U.S.A.  ')).toBe('u s a');
    expect(normalizeSearch('Côte d’Ivoire')).toBe('cote d ivoire');
    expect(normalizeSearch('Zürich—Basel')).toBe('zurich basel');
  });
});

describe('matchTier', () => {
  it('ranks exact, prefix, word start, then inside a word', () => {
    expect(matchTier('tokyo', 'tokyo')).toBe(0);
    expect(matchTier('tokyo', 'tok')).toBe(1);
    expect(matchTier('new york', 'york')).toBe(2);
    expect(matchTier('hindustantimes com', 'times')).toBe(3);
    expect(matchTier('hindustantimes com', 'ti')).toBeNull();
    expect(matchTier('tokyo', 'kyoto')).toBeNull();
  });
});

describe('search', () => {
  it('needs two characters', () => {
    expect(search(sources(), 't', NOW)).toEqual(NO_RESULTS);
    expect(search(sources(), '  ', NOW)).toEqual(NO_RESULTS);
  });

  it('finds cities by name or plain-ASCII name, accents ignored', () => {
    expect(search(sources(), 'tok', NOW).places[0]).toMatchObject({
      kind: 'city',
      label: 'Tokyo',
      detail: 'Japan',
    });
    expect(search(sources(), 'sao paulo', NOW).places[0]?.label).toBe('São Paulo');
    expect(search(sources(), 'hargeysa', NOW).places[0]?.label).toBe('Hargeisa');
  });

  it('finds countries by any of their names, ahead of cities', () => {
    const usa = search(sources(), 'usa', NOW).places[0];
    expect(usa).toMatchObject({ kind: 'country', label: 'United States of America' });
    expect(usa?.radiusDeg).toBe(23.1);
    expect(search(sources(), 'united states', NOW).places[0]?.kind).toBe('country');
  });

  it('adds places the stories name where the gazetteer has no city', () => {
    const found = search(sources(), 'kramatorsk', NOW).places;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'place',
      label: 'Kramatorsk, Donetsk, Ukraine',
      detail: '1 story',
    });
    expect(found[0]?.lat).toBeCloseTo(48.72, 2);
    // Tokyo's stories sit on a gazetteer city: no duplicate "Tokyo, Japan".
    expect(search(sources(), 'tokyo', NOW).places.map((p) => p.kind)).toEqual(['city']);
  });

  it('finds topics with how many stories they have', () => {
    expect(search(sources(), 'clim', NOW).topics).toEqual([
      { kind: 'topic', key: 'topic:climate', label: 'Climate', category: 'climate', count: 2 },
    ]);
  });

  it('finds stories by every word of the query, newest first, as of the displayed instant', () => {
    const tokyo = search(sources(), 'tokyo', NOW).stories;
    expect(tokyo.map((s) => s.id)).toEqual([12, 11]);
    expect(search(sources(), 'tokyo heat', NOW).stories.map((s) => s.id)).toEqual([11]);
    expect(
      search(sources(), 'tokyo heat', FIXTURE_EPOCH_SEC + 10_000).stories.map((s) => s.id),
    ).toEqual([14, 11]);
    expect(search(sources(), 'eat', NOW).stories).toEqual([]);
  });

  it('finds outlets inside a domain, most stories first', () => {
    expect(search(sources(), 'times', NOW).outlets.map((o) => o.outlet)).toEqual([
      'times.example',
      'hindustantimes.com',
    ]);
    expect(search(sources(), 'tasman', NOW).outlets[0]).toMatchObject({
      outlet: 'Tasman Record',
      count: 12,
    });
  });

  it('works with only some sources loaded', () => {
    const partial: SearchSources = { places: null, stories: null, nodes: null, outlets: null };
    expect(search(partial, 'tokyo', NOW)).toEqual(NO_RESULTS);
    expect(resultCount(search(sources(), 'tokyo', NOW))).toBe(3);
  });

  it('answers in milliseconds over the real gazetteer and 3,000 stories', () => {
    const real = parsePlaces(
      JSON.parse(
        readFileSync(new URL('../../public/data/places.v1.json', import.meta.url), 'utf8'),
      ),
    );
    const nodes = fillMockNodes(createNodeBuffer(3000), {
      count: 3000,
      windowEndMs: (FIXTURE_EPOCH_SEC + 86_400) * 1000,
      windowHours: 24,
      seed: 7,
    });
    const all: SearchSources = {
      places: indexPlaces(real),
      stories: indexStories(nodes, real),
      nodes,
      outlets: null,
    };
    const started = performance.now();
    for (const query of ['lo', 'lon', 'lond', 'london', 'sao', 'new y', 'placeholder 12']) {
      search(all, query, FIXTURE_EPOCH_SEC + 86_400);
    }
    const perQuery = (performance.now() - started) / 7;
    expect(search(all, 'london', FIXTURE_EPOCH_SEC + 86_400).places[0]?.label).toBe('London');
    // The budget is 150 ms from keystroke to results; the search itself is a sliver of it.
    expect(perQuery).toBeLessThan(50);
  });
});
