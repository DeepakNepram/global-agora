import { describe, expect, it } from 'vitest';

import type { StoryDetail } from '@/core';
import { FIXTURE_EPOCH_SEC, storyBuffer } from '@/core/cluster/cluster.fixture';

import { summarize } from './storySummary';

function detail(over: Partial<StoryDetail> = {}): StoryDetail {
  return {
    id: 7,
    uuid: 'u',
    title: 'Full title',
    summary: null,
    category: 'world',
    heat: 1,
    sourceCount: 9,
    publishedAtMs: 123_000,
    firstSeenAtMs: 123_000,
    place: {
      name: 'Lagos, Nigeria',
      lat: 6.5,
      lon: 3.4,
      source: 'gdelt',
      confidence: 70,
      countryCode: 'NG',
    },
    discussion: { state: 'queued', participants: null },
    articleCount: 1,
    articles: [
      {
        outlet: 'lead.example',
        outletCountry: null,
        headline: 'Full title',
        url: 'https://lead.example/1',
        publishedAtMs: null,
        snippet: null,
      },
    ],
    ...over,
  };
}

const nodes = storyBuffer([
  { id: 5, lat: 10, lon: 20, t: 60 },
  { id: 7, lat: -33.9, lon: 151.2, t: 120 },
]);
nodes.places[1] = 'Sydney, Australia';
nodes.sourceCounts[1] = 4;
nodes.discussionOpen[0] = 1;

describe('summarize', () => {
  it('fills the card from the payload row at once', () => {
    const summary = summarize(nodes, 7, null);
    expect(summary).toMatchObject({
      id: 7,
      headline: 'Story 7',
      place: 'Sydney, Australia',
      sourceCount: 4,
      publishedAtMs: (FIXTURE_EPOCH_SEC + 120) * 1000,
      outlet: null,
      discussion: 'none',
      row: 1,
    });
    expect(summary?.at.lat).toBeCloseTo(-33.9, 4);
    expect(summary?.at.lon).toBeCloseTo(151.2, 4);
    expect(summarize(nodes, 5, null)?.discussion).toBe('open');
  });

  it('adds the outlet and the discussion once the full story arrives', () => {
    const summary = summarize(nodes, 7, detail({ discussion: { state: 'open', participants: 3 } }));
    expect(summary).toMatchObject({ outlet: 'lead.example', discussion: 'open', participants: 3 });
    // The payload's columns still win for what the globe shows.
    expect(summary?.headline).toBe('Story 7');
  });

  it('opens a story outside the payload from its details alone', () => {
    expect(summarize(nodes, 99, null)).toBeNull();
    const outside = summarize(nodes, 7, null);
    expect(outside?.row).toBe(1);
    const linked = summarize(null, 7, detail());
    expect(linked).toMatchObject({
      headline: 'Full title',
      place: 'Lagos, Nigeria',
      sourceCount: 9,
      outlet: 'lead.example',
      discussion: 'queued',
      at: { lat: 6.5, lon: 3.4 },
      row: -1,
    });
  });

  it('ignores details that belong to another story', () => {
    expect(summarize(null, 8, detail())).toBeNull();
  });
});
