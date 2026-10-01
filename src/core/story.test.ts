import { describe, expect, it } from 'vitest';

import type { StoryArticle, StoryDetail, StoryPlace } from './data/story';
import { latLonToVec3, type LatLon } from './geo';
import { createNodeBuffer, type NodeBuffer } from './nodeBuffer';
import {
  groupByOutlet,
  leadOutlet,
  nearbyStories,
  outletName,
  placeConfidence,
  placeExplanation,
  rowOfStory,
} from './story';

function article(over: Partial<StoryArticle> = {}): StoryArticle {
  return {
    outlet: 'a.example',
    outletCountry: null,
    headline: 'A headline',
    url: 'https://a.example/1',
    publishedAtMs: null,
    snippet: null,
    ...over,
  };
}

function detail(articles: StoryArticle[], title = 'The story'): StoryDetail {
  return {
    id: 1,
    uuid: 'u',
    title,
    summary: null,
    category: 'world',
    heat: 1,
    sourceCount: articles.length,
    publishedAtMs: 0,
    firstSeenAtMs: 0,
    place: { name: '', lat: 0, lon: 0, source: null, confidence: null, countryCode: null },
    discussion: { state: 'none', participants: null },
    articleCount: articles.length,
    articles,
  };
}

const T = Date.UTC(2026, 9, 1, 12);

describe('outlets', () => {
  it('names an article by its outlet, else its host', () => {
    expect(outletName(article({ outlet: ' bbc.co.uk ' }))).toBe('bbc.co.uk');
    expect(outletName(article({ outlet: null, url: 'https://www.reuters.com/x' }))).toBe(
      'reuters.com',
    );
    expect(outletName(article({ outlet: '', url: 'https://ap.example/y' }))).toBe('ap.example');
  });

  it('leads with the outlet whose headline titles the story', () => {
    const story = detail(
      [
        article({ outlet: 'late.example', publishedAtMs: T }),
        article({ outlet: 'title.example', headline: 'The story', publishedAtMs: T + 1 }),
      ],
      'The story',
    );
    expect(leadOutlet(story)).toBe('title.example');
  });

  it('else with the earliest dated article, else the first, else none', () => {
    const dated = detail([
      article({ outlet: 'later.example', publishedAtMs: T + 60_000 }),
      article({ outlet: 'undated.example' }),
      article({ outlet: 'first.example', publishedAtMs: T }),
    ]);
    expect(leadOutlet(dated)).toBe('first.example');
    expect(leadOutlet(detail([article({ outlet: 'only.example' })]))).toBe('only.example');
    expect(leadOutlet(detail([]))).toBeNull();
  });

  it('groups every article under its outlet, newest outlets first', () => {
    const groups = groupByOutlet([
      article({ outlet: 'a.example', headline: 'a old', publishedAtMs: T }),
      article({ outlet: 'b.example', headline: 'b', publishedAtMs: T + 2, outletCountry: 'GB' }),
      article({
        outlet: 'a.example',
        headline: 'a new',
        publishedAtMs: T + 3,
        outletCountry: 'US',
      }),
      article({ outlet: 'c.example', headline: 'c undated' }),
    ]);
    expect(groups.map((g) => g.outlet)).toEqual(['a.example', 'b.example', 'c.example']);
    expect(groups[0]?.articles.map((a) => a.headline)).toEqual(['a new', 'a old']);
    expect(groups[0]?.country).toBe('US');
    expect(groups[1]?.country).toBe('GB');
    expect(groups.reduce((sum, g) => sum + g.articles.length, 0)).toBe(4);
  });
});

describe('why this location', () => {
  const place = (over: Partial<StoryPlace>): StoryPlace => ({
    name: 'Tokyo, Japan',
    lat: 35.68,
    lon: 139.69,
    source: 'gdelt',
    confidence: 80,
    countryCode: 'JP',
    ...over,
  });

  it('grades ingest confidence', () => {
    expect(placeConfidence(80)).toBe('high');
    expect(placeConfidence(60)).toBe('high');
    expect(placeConfidence(55)).toBe('medium');
    expect(placeConfidence(30)).toBe('low');
    expect(placeConfidence(null)).toBeNull();
  });

  it('says who placed the pin, where and how surely', () => {
    expect(placeExplanation(place({}))).toBe(
      'Placed automatically: Tokyo, Japan is the place these reports name most. High confidence.',
    );
    expect(placeExplanation(place({ confidence: 20 }))).toMatch(/Low confidence: the reports/);
    expect(placeExplanation(place({ confidence: null }))).toBe(
      'Placed automatically: Tokyo, Japan is the place these reports name most.',
    );
    expect(placeExplanation(place({ source: 'dateline' }))).toBe(
      "Placed from the reports' dateline: they were filed from Tokyo, Japan.",
    );
    expect(placeExplanation(place({ source: 'manual' }))).toBe(
      'Placed by an editor at Tokyo, Japan.',
    );
    expect(placeExplanation(place({ source: null, name: ' ' }))).toBe(
      'Pinned at this spot. How this place was chosen was not recorded.',
    );
  });
});

/** Stories at these places, published `t` seconds after the window start. */
function nodesAt(places: (LatLon & { t?: number; heat?: number })[]): NodeBuffer {
  const nodes = createNodeBuffer(places.length);
  nodes.count = places.length;
  nodes.epochSec = 1_000_000;
  places.forEach((at, row) => {
    const v = latLonToVec3(at);
    nodes.positions.set([v.x, v.y, v.z], row * 3);
    nodes.ids[row] = 100 + row;
    nodes.publishedSec[row] = at.t ?? 0;
    nodes.heat[row] = at.heat ?? 0;
  });
  return nodes;
}

describe('nearbyStories', () => {
  const nodes = nodesAt([
    { lat: 51.5, lon: -0.12 }, // 0 London
    { lat: 48.86, lon: 2.35 }, // 1 Paris, ~340 km
    { lat: 52.37, lon: 4.9 }, // 2 Amsterdam, ~360 km
    { lat: 40.71, lon: -74.0 }, // 3 New York, far
    { lat: 51.5, lon: -0.12, heat: 9 }, // 4 London again, hotter
    { lat: 51.5, lon: -0.12, heat: 1 }, // 5 London again
    { lat: 53.48, lon: -2.24, t: 5000 }, // 6 Manchester, published later
  ]);

  it('lists the closest published stories within reach, nearest first', () => {
    const found = nearbyStories(nodes, 0, nodes.epochSec + 100);
    expect(found.map((s) => s.row)).toEqual([4, 5, 1, 2]);
    expect(found[0]?.km).toBeCloseTo(0, 6);
    expect(found[2]?.km).toBeGreaterThan(330);
    expect(found[2]?.km).toBeLessThan(350);
  });

  it('includes a story once the displayed instant reaches it', () => {
    const later = nearbyStories(nodes, 0, nodes.epochSec + 5000, { limit: 10 });
    expect(later.map((s) => s.row)).toContain(6);
  });

  it('honours the limit and the distance', () => {
    expect(nearbyStories(nodes, 0, Infinity, { limit: 2 }).map((s) => s.row)).toEqual([4, 5]);
    expect(nearbyStories(nodes, 3, Infinity)).toEqual([]);
    expect(nearbyStories(nodes, 3, Infinity, { maxKm: 6000 }).length).toBeGreaterThan(0);
    expect(nearbyStories(nodes, -1, Infinity)).toEqual([]);
  });
});

describe('rowOfStory', () => {
  it('finds a story by id, or -1', () => {
    const nodes = nodesAt([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
    ]);
    expect(rowOfStory(nodes, 101)).toBe(1);
    expect(rowOfStory(nodes, 100)).toBe(0);
    expect(rowOfStory(nodes, 7)).toBe(-1);
  });
});
