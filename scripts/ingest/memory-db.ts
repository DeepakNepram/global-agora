/**
 * An in-memory IngestDb for the replay tool: the same contract as the SQL
 * functions in supabase/migrations/20260924120000_ingest.sql, so a replay
 * groups and scores exactly as the Worker would, without a database.
 *
 * Mirrors: claim/finish semantics, known URLs, candidate lookup (keys shared,
 * top three by overlap), ingest_apply's guards (queued stories keep title
 * and place, heat only rises, state only moves none -> queued) and prune.
 */

import type { Json } from '../../src/core/db/types.ts';
import type {
  ApplyResult,
  CandidateRow,
  IngestDb,
  PruneResult,
} from '../../workers/ingest/src/db/service.ts';
import type {
  ArticleWrite,
  SignalWrite,
  StoryWrite,
} from '../../workers/ingest/src/pipeline/plan.ts';

export interface StoredStory extends Omit<StoryWrite, 'discussion_state'> {
  discussion_state: string;
}

export interface MemoryDb extends IngestDb {
  readonly stories: Map<string, StoredStory>;
  readonly signals: Map<string, SignalWrite>;
  readonly articles: Map<string, ArticleWrite>;
}

const FROZEN: readonly (keyof StoryWrite)[] = [
  'title',
  'title_hash',
  'category',
  'lat',
  'lon',
  'place_name',
  'place_conf',
  'country_code',
];

export function createMemoryDb(): MemoryDb {
  const runs = new Map<string, { status: string; attempts: number }>();
  const stories = new Map<string, StoredStory>();
  const signals = new Map<string, SignalWrite>();
  const articles = new Map<string, ArticleWrite>();

  return {
    stories,
    signals,
    articles,

    async cursor() {
      const finished = [...runs].filter(([, r]) => r.status === 'done' || r.status === 'skipped');
      return (
        finished
          .map(([slot]) => slot)
          .sort()
          .at(-1) ?? null
      );
    },

    async claim(slot) {
      const run = runs.get(slot);
      if (run !== undefined && run.status !== 'failed') return false;
      runs.set(slot, { status: 'running', attempts: (run?.attempts ?? 0) + 1 });
      return true;
    },

    async finish(slot, status) {
      const attempts = runs.get(slot)?.attempts ?? 1;
      const final = status === 'failed' && attempts >= 3 ? 'skipped' : status;
      runs.set(slot, { status: final, attempts });
      return final;
    },

    async knownUrls(urls) {
      return new Set(urls.filter((url) => articles.has(url)));
    },

    async candidates(clusters, sinceIso): Promise<CandidateRow[]> {
      const since = Date.parse(sinceIso);
      const rows: CandidateRow[] = [];
      for (const cluster of clusters) {
        const wanted = new Set(cluster.keys);
        const hits: { id: string; overlap: number; seen: number }[] = [];
        for (const signal of signals.values()) {
          const seen = Date.parse(signal.last_seen_at);
          if (seen < since) continue;
          const overlap = signal.keys.filter((key) => wanted.has(key)).length;
          if (overlap >= 2) hits.push({ id: signal.story_id, overlap, seen });
        }
        hits.sort((a, b) => b.overlap - a.overlap || b.seen - a.seen || (a.id < b.id ? -1 : 1));
        for (const hit of hits.slice(0, 3)) {
          const story = stories.get(hit.id);
          const signal = signals.get(hit.id);
          if (story === undefined || signal === undefined) continue;
          rows.push({
            cluster: cluster.i,
            story_id: hit.id,
            overlap: hit.overlap,
            keys: signal.keys,
            state: JSON.parse(JSON.stringify(signal.state)) as Json,
            discussion_state: story.discussion_state,
            heat: story.heat,
            published_at: story.published_at,
            first_seen_at: story.first_seen_at,
          });
        }
      }
      return rows;
    },

    async apply(batch): Promise<ApplyResult> {
      const b = batch as unknown as {
        slot: string;
        stories: StoryWrite[];
        signals: SignalWrite[];
        articles: ArticleWrite[];
      };
      let created = 0;
      let updated = 0;
      for (const write of b.stories) {
        const current = stories.get(write.id);
        if (current === undefined) {
          stories.set(write.id, { ...write });
          created++;
          continue;
        }
        updated++;
        const next: StoredStory = { ...current };
        if (current.discussion_state === 'none') {
          for (const field of FROZEN) Object.assign(next, { [field]: write[field] });
          if (write.discussion_state === 'queued') next.discussion_state = 'queued';
        }
        next.heat = Math.max(current.heat, write.heat);
        next.sentiment = write.sentiment;
        next.source_count = Math.max(current.source_count, write.source_count);
        next.published_at =
          write.published_at < current.published_at ? write.published_at : current.published_at;
        stories.set(write.id, next);
      }
      for (const signal of b.signals) signals.set(signal.story_id, signal);
      let inserted = 0;
      for (const article of b.articles) {
        if (articles.has(article.url)) continue;
        articles.set(article.url, article);
        inserted++;
      }
      runs.set(b.slot, { status: 'done', attempts: runs.get(b.slot)?.attempts ?? 1 });
      return { stories_new: created, stories_updated: updated, articles_new: inserted };
    },

    async prune(storyCutoffIso, runCutoffIso, signalCutoffIso): Promise<PruneResult> {
      let deleted = 0;
      for (const [id, story] of stories) {
        if (story.published_at >= storyCutoffIso) continue;
        stories.delete(id);
        signals.delete(id);
        for (const [url, article] of articles) if (article.story_id === id) articles.delete(url);
        deleted++;
      }
      let runsDeleted = 0;
      for (const slot of runs.keys()) {
        if (slot < runCutoffIso) {
          runs.delete(slot);
          runsDeleted++;
        }
      }
      let signalsDeleted = 0;
      for (const [id, signal] of signals) {
        if (signal.last_seen_at < signalCutoffIso) {
          signals.delete(id);
          signalsDeleted++;
        }
      }
      return {
        stories_deleted: deleted,
        stories_kept_for_discussion: 0,
        runs_deleted: runsDeleted,
        signals_deleted: signalsDeleted,
      };
    },
  };
}
