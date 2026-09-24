import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../src/config.ts';
import type { CandidateRow } from '../src/db/service.ts';
import { clusterWriteups, groupWriteups } from '../src/dedup/cluster.ts';
import { normalizeRecord, type IngestArticle } from '../src/normalize/article.ts';
import { createOutletCountries } from '../src/normalize/outlets.ts';
import { clusterKeys, planBatch, type Plan, type StoryWrite } from '../src/pipeline/plan.ts';
import {
  bestPlace,
  deriveStory,
  emptyState,
  mergeWriteups,
  readState,
} from '../src/pipeline/signals.ts';

import { fixtureRecords } from './helpers.ts';

const outletCountry = createOutletCountries(
  readFileSync(new URL('../src/data/outlet-countries.txt', import.meta.url), 'utf8'),
);
const all: IngestArticle[] = fixtureRecords().flatMap((record) => {
  const result = normalizeRecord(record, { outletCountry });
  return result.ok ? [result.article] : [];
});
const BATCH_TIME = Date.UTC(2026, 8, 24, 8, 45) / 1000;
/** Unique across plans, as random UUIDs are: a reused id would hide a missed match. */
let ids = 0;

function plan(
  articles: readonly IngestArticle[],
  candidates: CandidateRow[] = [],
  queueHeat = 215,
): Plan {
  return planBatch({
    batchTime: BATCH_TIME,
    clusters: clusterWriteups(groupWriteups(articles).writeups),
    candidates,
    queueHeat,
    heat: DEFAULT_CONFIG.heat,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  });
}

const storyWith = (p: Plan, urlPrefix: string): StoryWrite => {
  const id = p.articles.find((a) => a.url.startsWith(urlPrefix))?.story_id;
  const story = p.stories.find((s) => s.id === id);
  if (story === undefined) throw new Error(`no story holds ${urlPrefix}`);
  return story;
};

/** The stored row a later run would get back from ingest_candidates. */
function asCandidate(p: Plan, story: StoryWrite, cluster: number): CandidateRow {
  const signal = p.signals.find((s) => s.story_id === story.id);
  if (signal === undefined) throw new Error('no signals');
  return {
    cluster,
    story_id: story.id,
    overlap: 5,
    keys: signal.keys,
    state: JSON.parse(JSON.stringify(signal.state)) as CandidateRow['state'],
    discussion_state: story.discussion_state,
    heat: story.heat,
    published_at: story.published_at,
    first_seen_at: story.first_seen_at,
  };
}

describe('planBatch on real rows', () => {
  const result = plan(all);

  it('makes the White House ruling one story, placed at the White House', () => {
    const ruling = storyWith(result, 'https://www.kccu.org/business/');
    expect(ruling.place_name).toBe('White House, District Of Columbia, United States');
    expect(ruling.country_code).toBe('US');
    expect(ruling.category).toBe(2); // politics
    expect(ruling.title).toMatch(/judge/i);
    expect(result.articles.filter((a) => a.story_id === ruling.id).length).toBeGreaterThanOrEqual(
      15,
    );
  });

  it('attaches unplaced copies to the placed story they belong to', () => {
    // leaderlive's copy of the ruling has no GDELT location of its own.
    const ruling = storyWith(result, 'https://www.kccu.org/business/');
    expect(storyWith(result, 'https://www.leaderlive.co.uk/news/national/26577103').id).toBe(
      ruling.id,
    );
  });

  it('skips and counts a story no article places', () => {
    expect(result.articles.some((a) => a.url.includes('vistry'))).toBe(false);
    expect(result.stats.unplacedClusters).toBeGreaterThanOrEqual(1);
    expect(result.stats.unplacedArticles).toBeGreaterThanOrEqual(2);
  });

  it('dates a story by its earliest article', () => {
    const ruling = storyWith(result, 'https://www.kccu.org/business/');
    const times = result.articles
      .filter((a) => a.story_id === ruling.id)
      .map((a) => a.published_at);
    expect(ruling.published_at).toBe([...times].sort()[0]);
    expect(ruling.first_seen_at).toBe(new Date(BATCH_TIME * 1000).toISOString());
  });

  it('queues stories at the threshold and not below it', () => {
    const ruling = storyWith(result, 'https://www.kccu.org/business/');
    const low = plan(all, [], ruling.heat);
    expect(storyWith(low, 'https://www.kccu.org/business/').discussion_state).toBe('queued');
    const high = plan(all, [], ruling.heat + 1);
    expect(storyWith(high, 'https://www.kccu.org/business/').discussion_state).toBe('none');
    expect(high.stats.queued).toBe(0);
  });

  it('writes values the database accepts', () => {
    for (const story of result.stories) {
      expect(story.heat).toBeGreaterThanOrEqual(0);
      expect(story.heat).toBeLessThanOrEqual(255);
      expect(story.place_conf).toBeGreaterThanOrEqual(0);
      expect(story.place_conf).toBeLessThanOrEqual(100);
      expect(story.title.length).toBeLessThanOrEqual(300);
      expect(story.place_name.length).toBeLessThanOrEqual(120);
      expect(story.country_code === null || /^[A-Z]{2}$/.test(story.country_code)).toBe(true);
      expect(BigInt(story.title_hash)).toBeGreaterThanOrEqual(-(2n ** 63n));
    }
    for (const signal of result.signals) {
      expect(signal.keys.length).toBeLessThanOrEqual(64);
      expect(JSON.stringify(signal.state).length).toBeLessThan(65536);
    }
  });
});

describe('merging into stored stories', () => {
  const firstHalf = all.filter((a) => a.seenAt < Date.UTC(2026, 8, 24, 8, 15) / 1000);
  const secondHalf = all.filter((a) => !firstHalf.includes(a));
  const first = plan(firstHalf);
  const ruling = storyWith(first, 'https://www.kccu.org/business/');

  function secondRun(discussionState = 'none'): Plan {
    const clusters = clusterWriteups(groupWriteups(secondHalf).writeups);
    const index = clusters.findIndex((c) =>
      c.writeups.some((w) => w.articles.some((a) => a.url.startsWith('https://www.wdsu.com/'))),
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(clusterKeys(clusters[index] ?? clusters[0]!).length).toBeGreaterThanOrEqual(2);
    return plan(secondHalf, [
      { ...asCandidate(first, ruling, index), discussion_state: discussionState },
    ]);
  }

  it('adds later coverage to the existing story instead of making a new one', () => {
    const second = secondRun();
    expect(storyWith(second, 'https://www.wdsu.com/').id).toBe(ruling.id);
    expect(second.stats.matchedExisting).toBeGreaterThanOrEqual(1);
    expect(second.stats.storiesUpdated).toBeGreaterThanOrEqual(1);
  });

  it('keeps when it was first seen, and counts every source so far', () => {
    const updated = storyWith(secondRun(), 'https://www.wdsu.com/');
    expect(updated.first_seen_at).toBe(ruling.first_seen_at);
    expect(updated.source_count).toBeGreaterThan(ruling.source_count);
  });

  it('drops a later copy of a write-up the story has, from an outlet it has', () => {
    // Three iHeart stations carried one write-up; a later station's copy adds nothing.
    const iheart = all.filter((a) => a.outlet === 'iheart.com');
    const [kept, ...later] = iheart;
    expect(kept).toBeDefined();
    const earlier = plan(all.filter((a) => !later.includes(a)));
    const story = storyWith(earlier, kept?.url ?? '');
    const clusters = clusterWriteups(groupWriteups(later).writeups);
    const again = plan(
      later,
      clusters.map((_, i) => asCandidate(earlier, story, i)),
    );
    expect(again.articles).toEqual([]);
    // The two later copies already collapse to one within their own batch.
    expect(later).toHaveLength(2);
    expect(again.stats.knownCopies).toBe(1);
  });

  it('does not count a queued story as newly queued', () => {
    const second = secondRun('queued');
    expect(storyWith(second, 'https://www.wdsu.com/').discussion_state).toBe('none');
    expect(second.stats.queued).toBe(0);
  });
});

describe('signals', () => {
  const { writeups } = groupWriteups(all);

  it('reads only states it understands', () => {
    expect(readState(emptyState())).not.toBeNull();
    expect(readState({ v: 99, writeups: [], outlets: [] })).toBeNull();
    expect(readState(null)).toBeNull();
  });

  it('has no story without a place', () => {
    const state = emptyState();
    const vistry = writeups.filter((w) => w.articles.some((a) => a.url.includes('vistry')));
    mergeWriteups(state, vistry, BATCH_TIME);
    expect(bestPlace(state)).toBeNull();
    expect(deriveStory(state, BATCH_TIME, DEFAULT_CONFIG.heat)).toBeNull();
  });

  it('counts a re-seen write-up once, and its new outlets', () => {
    const state = emptyState();
    const ruling = writeups.filter((w) => w.articles.some((a) => a.url.includes('newsitem.com')));
    mergeWriteups(state, ruling, BATCH_TIME);
    const before = { w: state.w, o: state.writeups[0]?.o ?? 0 };
    mergeWriteups(state, ruling, BATCH_TIME);
    expect(state.w).toBe(before.w);
    expect(state.writeups[0]?.o).toBe(before.o);
  });

  it('forgets sightings older than an hour when scoring velocity', () => {
    const state = emptyState();
    mergeWriteups(state, writeups.slice(0, 5), BATCH_TIME);
    expect(state.recent.length).toBeGreaterThan(0);
    mergeWriteups(state, [], BATCH_TIME + 2 * 3600);
    expect(state.recent).toEqual([]);
  });
});
