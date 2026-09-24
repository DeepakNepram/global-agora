/**
 * One slot's clusters + the matching stories already stored -> the rows to
 * write. Pure: no I/O, so the whole decision is unit-tested on real rows.
 *
 * - A cluster that matches a stored story (keys.ts: sameEvent, or a
 *   near-duplicate headline) is merged into it; several clusters may merge
 *   into one story.
 * - Otherwise it becomes a new story, if any of its articles has a place.
 *   Clusters with no place anywhere are the gaps: skipped and counted. (An
 *   unplaced article that joins a placed story is kept: the story has a place.)
 * - A story crosses into `queued` when its heat reaches the threshold.
 */

import { clusterArticles, signature, type Cluster, type Writeup } from '../dedup/cluster.ts';
import { sameEvent, sharedKeys } from '../dedup/keys.ts';
import { fromHex, isNearDuplicate } from '../dedup/simhash.ts';
import type { IngestArticle } from '../normalize/article.ts';
import type { CandidateRow } from '../db/service.ts';
import type { HeatConfig } from '../score/heat.ts';

import { deriveStory, emptyState, mergeWriteups, readState, type SignalState } from './signals.ts';

export interface StoryWrite {
  id: string;
  title: string;
  category: number;
  lat: number;
  lon: number;
  place_name: string;
  place_conf: number;
  country_code: string | null;
  heat: number;
  sentiment: number;
  source_count: number;
  published_at: string;
  first_seen_at: string;
  title_hash: string;
  discussion_state: 'none' | 'queued';
}

export interface SignalWrite {
  story_id: string;
  keys: string[];
  state: SignalState;
  last_seen_at: string;
}

export interface ArticleWrite {
  story_id: string;
  url: string;
  outlet: string;
  outlet_country: string | null;
  headline: string;
  image_url: string | null;
  published_at: string;
  lang: string;
}

export interface PlanStats {
  clusters: number;
  /** Copies of a write-up the story already has, on an outlet it already has. */
  knownCopies: number;
  matchedExisting: number;
  storiesNew: number;
  storiesUpdated: number;
  queued: number;
  unplacedClusters: number;
  unplacedArticles: number;
}

export interface Plan {
  stories: StoryWrite[];
  signals: SignalWrite[];
  articles: ArticleWrite[];
  stats: PlanStats;
  /** Headline and heat of the hottest stories written, for the run log. */
  hottest: { title: string; heat: number; sources: number }[];
}

export interface PlanInput {
  readonly batchTime: number;
  readonly clusters: readonly Cluster[];
  /** Candidate rows from ingest_candidates, `cluster` indexing into `clusters`. */
  readonly candidates: readonly CandidateRow[];
  readonly queueHeat: number;
  readonly heat: HeatConfig;
  readonly newId: () => string;
}

/** The keys a cluster is matched on: its signature. */
export function clusterKeys(cluster: Cluster): string[] {
  return signature(cluster.keyCounts, cluster.writeups.length);
}

function matches(cluster: Cluster, candidate: CandidateRow): boolean {
  if (sameEvent(sharedKeys(clusterKeys(cluster), new Set(candidate.keys)))) return true;
  const state = readState(candidate.state);
  return (state?.writeups ?? []).some((w) => {
    const hash = fromHex(w.h);
    return hash !== null && cluster.writeups.some((c) => isNearDuplicate(c.hash, hash));
  });
}

const iso = (sec: number): string => new Date(sec * 1000).toISOString();

/**
 * A stored story already carrying this write-up from an outlet does not need
 * the outlet's second copy (another iHeart station, say): same-outlet copies
 * are dropped within a batch, and this drops them across batches.
 */
function withoutKnownCopies(state: SignalState, writeup: Writeup): Writeup {
  const known = state.writeups.some((w) => {
    const hash = fromHex(w.h);
    return hash !== null && isNearDuplicate(hash, writeup.hash);
  });
  if (!known) return writeup;
  return {
    ...writeup,
    articles: writeup.articles.filter((a) => !state.outlets.includes(a.outlet)),
  };
}

interface Target {
  readonly id: string;
  readonly state: SignalState;
  readonly existing: CandidateRow | null;
  readonly clusters: Cluster[];
}

export function planBatch(input: PlanInput): Plan {
  const byCluster = new Map<number, CandidateRow[]>();
  for (const row of input.candidates) {
    byCluster.set(row.cluster, [...(byCluster.get(row.cluster) ?? []), row]);
  }

  const targets = new Map<string, Target>();
  const stats: PlanStats = {
    clusters: input.clusters.length,
    knownCopies: 0,
    matchedExisting: 0,
    storiesNew: 0,
    storiesUpdated: 0,
    queued: 0,
    unplacedClusters: 0,
    unplacedArticles: 0,
  };

  input.clusters.forEach((cluster, index) => {
    const candidates = [...(byCluster.get(index) ?? [])].sort((a, b) => b.overlap - a.overlap);
    const match = candidates.find((row) => matches(cluster, row));

    if (match !== undefined) {
      stats.matchedExisting++;
      const target = targets.get(match.story_id) ?? {
        id: match.story_id,
        state: readState(match.state) ?? emptyState(),
        existing: match,
        clusters: [],
      };
      target.clusters.push(cluster);
      targets.set(match.story_id, target);
      return;
    }

    if (!clusterArticles(cluster).some((a) => a.place !== null)) {
      stats.unplacedClusters++;
      stats.unplacedArticles += clusterArticles(cluster).length;
      return;
    }
    const id = input.newId();
    targets.set(id, { id, state: emptyState(), existing: null, clusters: [cluster] });
  });

  const plan: Plan = { stories: [], signals: [], articles: [], stats, hottest: [] };

  for (const target of targets.values()) {
    const all = target.clusters.flatMap((c) => c.writeups);
    const writeups = all
      .map((w) => withoutKnownCopies(target.state, w))
      .filter((w) => w.articles.length > 0);
    stats.knownCopies +=
      all.reduce((n, w) => n + w.articles.length, 0) -
      writeups.reduce((n, w) => n + w.articles.length, 0);
    if (writeups.length === 0) continue;
    mergeWriteups(target.state, writeups, input.batchTime);
    const story = deriveStory(target.state, input.batchTime, input.heat);
    if (story === null) continue;

    const articles: IngestArticle[] = writeups.flatMap((w) => w.articles);
    const published = Math.min(...articles.map((a) => a.publishedAt));
    const current = target.existing?.discussion_state ?? 'none';
    const crosses = current === 'none' && story.heat >= input.queueHeat;
    if (crosses) stats.queued++;
    if (target.existing === null) stats.storiesNew++;
    else stats.storiesUpdated++;

    plan.stories.push({
      id: target.id,
      title: story.title,
      category: story.category,
      lat: story.lat,
      lon: story.lon,
      place_name: story.placeName,
      place_conf: story.placeConf,
      country_code: story.countryCode,
      heat: story.heat,
      sentiment: story.sentiment,
      source_count: story.sourceCount,
      published_at: iso(published),
      first_seen_at: target.existing?.first_seen_at ?? iso(input.batchTime),
      title_hash: story.titleHash,
      discussion_state: crosses ? 'queued' : 'none',
    });
    plan.signals.push({
      story_id: target.id,
      keys: signature(new Map(Object.entries(target.state.keys)), target.state.w),
      state: target.state,
      last_seen_at: iso(input.batchTime),
    });
    for (const article of articles) {
      plan.articles.push({
        story_id: target.id,
        url: article.url,
        outlet: article.outlet,
        outlet_country: article.outletCountry,
        headline: article.headline,
        image_url: article.imageUrl,
        published_at: iso(article.publishedAt),
        lang: article.lang,
      });
    }
  }

  plan.hottest = [...plan.stories]
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 5)
    .map((s) => ({ title: s.title, heat: s.heat, sources: s.source_count }));
  return plan;
}
