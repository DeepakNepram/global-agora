import { describe, expect, it } from 'vitest';

import { indexPlaces, parsePlaces, search } from '@/core';
import { storyBuffer } from '@/core/cluster/cluster.fixture';
import { samplePlacesJson } from '@/core/data/places.fixture';

import { categoryFollow, placeFollow, storyFollows } from './followInputs';

const places = parsePlaces(samplePlacesJson());

describe('placeFollow', () => {
  it('follows a country by code and a city by its id, with what the reader saw', () => {
    const index = indexPlaces(places);
    const find = (query: string) =>
      search({ places: index, stories: null, nodes: null, outlets: null }, query, 0).places[0];
    const usa = find('usa');
    const tokyo = find('tokyo');
    if (!usa || !tokyo) throw new Error('fixture places missing');
    expect(placeFollow(usa)).toEqual({
      kind: 'place',
      target: 'country:US',
      label: 'United States of America',
      baseline: null,
    });
    expect(placeFollow(tokyo)).toEqual({
      kind: 'place',
      target: 'city:1159151609',
      label: 'Tokyo, Japan',
      baseline: null,
    });
  });
});

describe('storyFollows', () => {
  const nodes = storyBuffer([{ id: 42, lat: 35.69, lon: 139.7, category: 5 }]);
  nodes.headlines[0] = 'Heatwave grips Tokyo';
  nodes.countryCodes[0] = 'JP';
  nodes.sourceCounts[0] = 7;

  it('offers the story, its city, its country and its category', () => {
    expect(storyFollows(nodes, 0, places).map((f) => [f.kind, f.target, f.label])).toEqual([
      ['story', '42', 'Heatwave grips Tokyo'],
      ['place', 'city:1159151609', 'Tokyo, Japan'],
      ['place', 'country:JP', 'Japan'],
      ['category', 'climate', 'Climate'],
    ]);
    expect(storyFollows(nodes, 0, places)[0]?.baseline).toBe(7);
  });

  it('offers only the story and its category before the gazetteer loads', () => {
    expect(storyFollows(nodes, 0, null).map((f) => f.kind)).toEqual(['story', 'category']);
  });

  it('labels a category by its name', () => {
    expect(categoryFollow('tech')).toEqual({
      kind: 'category',
      target: 'tech',
      label: 'Tech',
      baseline: null,
    });
  });
});
