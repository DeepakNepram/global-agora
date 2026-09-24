import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, type IngestConfig } from '../src/config.ts';
import type { ApplyResult, IngestDb, PruneResult } from '../src/db/service.ts';
import type { Feed } from '../src/gdelt/feed.ts';
import { slotIso, slotSeconds } from '../src/gdelt/slots.ts';
import { createLogger } from '../src/log.ts';
import { createOutletCountries } from '../src/normalize/outlets.ts';
import { runIngest, type RunDeps } from '../src/pipeline/run.ts';

import { FIXTURE_TEXT } from './helpers.ts';

const outletCountry = createOutletCountries(
  readFileSync(new URL('../src/data/outlet-countries.txt', import.meta.url), 'utf8'),
);

/** GDELT with a set of published slots; the manifest names one that is not out yet. */
function fakeFeed(published: Record<string, string>, listed: string): Feed & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    latestListedSlot: async () => listed,
    hasSlot: async (slot) => slot in published,
    fetchSlot: async (slot) => {
      fetched.push(slot);
      const text = published[slot];
      return text === undefined ? null : { text, bytes: text.length };
    },
  };
}

interface FakeDb extends IngestDb {
  runs: Map<string, { status: string; attempts: number; error?: string }>;
  applied: { slot: string; stories: unknown[]; articles: { url: string }[] }[];
  pruned: number;
}

function fakeDb(done: string[] = [], options: { failApply?: boolean } = {}): FakeDb {
  const runs = new Map(done.map((slot) => [slotIso(slot), { status: 'done', attempts: 1 }]));
  const db: FakeDb = {
    runs,
    applied: [],
    pruned: 0,
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
    async finish(slot, status, _counts, error) {
      runs.set(slot, {
        status,
        attempts: runs.get(slot)?.attempts ?? 1,
        ...(error ? { error } : {}),
      });
      return status;
    },
    async knownUrls() {
      return new Set(db.applied.flatMap((b) => b.articles.map((a) => a.url)));
    },
    async candidates() {
      return [];
    },
    async apply(batch): Promise<ApplyResult> {
      if (options.failApply === true) throw new Error('ingest_apply: HTTP 500');
      const b = batch as unknown as FakeDb['applied'][number];
      db.applied.push(b);
      runs.set(b.slot, { status: 'done', attempts: 1 });
      return { stories_new: b.stories.length, stories_updated: 0, articles_new: b.articles.length };
    },
    async prune(): Promise<PruneResult> {
      db.pruned++;
      return {
        stories_deleted: 0,
        stories_kept_for_discussion: 0,
        runs_deleted: 0,
        signals_deleted: 0,
      };
    },
  };
  return db;
}

const S0 = '20260924080000';
const S1 = '20260924081500';
const S2 = '20260924083000';

function deps(
  feed: Feed,
  db: IngestDb,
  nowSlot: string,
  lines: string[] = [],
  config: Partial<IngestConfig> = {},
): RunDeps {
  let n = 0;
  return {
    feed,
    db,
    fetch: async () => new Response(null, { status: 200 }),
    outletCountry,
    config: { ...DEFAULT_CONFIG, ...config },
    log: createLogger({ runId: 'test-run' }, (line) => lines.push(line)),
    // An hour after the slot: GKG files appear about that late.
    now: () => slotSeconds(nowSlot) + 3600,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  };
}

describe('runIngest', () => {
  it('starts from the newest file that exists, not the one the manifest names', async () => {
    const feed = fakeFeed({ [S0]: FIXTURE_TEXT }, S2);
    const db = fakeDb();
    const summary = await runIngest(deps(feed, db, S0), { trigger: 'cron' });
    expect(summary.slots.map((s) => [s.slot, s.status])).toEqual([[S0, 'done']]);
    expect(db.applied).toHaveLength(1);
    expect(db.applied[0]?.slot).toBe(slotIso(S0));
    expect(db.pruned).toBe(1);
  });

  it('walks forward from the last slot done, and waits at one not yet published', async () => {
    const feed = fakeFeed({ [S0]: FIXTURE_TEXT, [S1]: FIXTURE_TEXT }, S2);
    const db = fakeDb([S0]);
    const summary = await runIngest(deps(feed, db, S2), { trigger: 'cron' });
    expect(summary.slots.map((s) => [s.slot, s.status])).toEqual([
      [S1, 'done'],
      [S2, 'not_published'],
    ]);
    expect(db.runs.has(slotIso(S2))).toBe(false);
  });

  it('does not re-insert articles an earlier slot stored', async () => {
    const feed = fakeFeed({ [S0]: FIXTURE_TEXT, [S1]: FIXTURE_TEXT }, S1);
    const db = fakeDb();
    await runIngest(deps(feed, db, S0), { trigger: 'manual', slot: S0 });
    await runIngest(deps(feed, db, S1), { trigger: 'cron' });
    expect(db.applied.map((b) => b.slot)).toEqual([slotIso(S0), slotIso(S1)]);
    expect(db.applied[0]?.articles.length).toBeGreaterThan(0);
    // The fake database matches no stored stories, so the second run may still
    // write articles; what it must never do is send a URL the first one stored.
    const first = new Set(db.applied[0]?.articles.map((a) => a.url));
    expect(db.applied[1]?.articles.filter((a) => first.has(a.url))).toEqual([]);
  });

  it('marks a slot missing once it is long overdue, and moves on', async () => {
    const feed = fakeFeed({ [S0]: FIXTURE_TEXT, [S2]: FIXTURE_TEXT }, S2);
    const db = fakeDb([S0]);
    const summary = await runIngest(deps(feed, db, S2, [], { missingAfterMinutes: 30 }), {
      trigger: 'cron',
    });
    expect(summary.slots.map((s) => [s.slot, s.status])).toEqual([
      [S1, 'skipped'],
      [S2, 'done'],
    ]);
    expect(db.runs.get(slotIso(S1))?.status).toBe('skipped');
  });

  it('leaves a slot another run holds alone', async () => {
    const feed = fakeFeed({ [S1]: FIXTURE_TEXT }, S1);
    const db = fakeDb([S0]);
    db.runs.set(slotIso(S1), { status: 'running', attempts: 1 });
    const summary = await runIngest(deps(feed, db, S1), { trigger: 'cron' });
    expect(summary.slots).toEqual([{ slot: S1, status: 'busy' }]);
    expect(feed.fetched).toEqual([]);
  });

  it('records a failure so the slot is retried, and does not throw', async () => {
    const feed = fakeFeed({ [S1]: FIXTURE_TEXT }, S1);
    const db = fakeDb([S0], { failApply: true });
    const summary = await runIngest(deps(feed, db, S1), { trigger: 'cron' });
    expect(summary.slots[0]?.status).toBe('failed');
    expect(db.runs.get(slotIso(S1))).toMatchObject({
      status: 'failed',
      error: 'ingest_apply: HTTP 500',
    });
  });

  it('jumps to the newest slot when it has fallen too far behind', async () => {
    const feed = fakeFeed({ [S2]: FIXTURE_TEXT }, S2);
    const db = fakeDb(['20260923080000']);
    const lines: string[] = [];
    const summary = await runIngest(deps(feed, db, S2, lines), { trigger: 'cron' });
    expect(summary.slots.map((s) => s.slot)).toEqual([S2]);
    expect(lines.some((line) => JSON.parse(line).event === 'slot.gap')).toBe(true);
  });

  it('computes without writing on a dry run', async () => {
    const feed = fakeFeed({ [S1]: FIXTURE_TEXT }, S1);
    const db = fakeDb([S0]);
    const summary = await runIngest(deps(feed, db, S1), {
      trigger: 'manual',
      slot: S1,
      dryRun: true,
    });
    expect(summary.slots[0]?.status).toBe('dry_run');
    expect(summary.slots[0]?.hottest?.[0]?.title).toMatch(/judge/i);
    expect(db.applied).toEqual([]);
    expect(db.runs.has(slotIso(S1))).toBe(false);
    expect(db.pruned).toBe(0);
  });

  it('refuses a manual slot that is not a quarter hour', async () => {
    const feed = fakeFeed({}, S1);
    await expect(
      runIngest(deps(feed, fakeDb(), S1), { trigger: 'manual', slot: '20260924081000' }),
    ).rejects.toThrow(/not a GDELT slot/);
  });

  it('logs one JSON object per step, each with the run id, and counts every skip', async () => {
    const feed = fakeFeed({ [S0]: FIXTURE_TEXT }, S0);
    const lines: string[] = [];
    await runIngest(deps(feed, fakeDb(), S0, lines), { trigger: 'cron' });
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.every((e) => e['runId'] === 'test-run' && typeof e['ts'] === 'string')).toBe(
      true,
    );
    expect(events.map((e) => e['event'])).toEqual(
      expect.arrayContaining([
        'run.start',
        'slot.claimed',
        'feed.fetched',
        'parse',
        'skipped',
        'dedup',
        'grouping',
        'heat',
        'db.applied',
        'prune',
        'run.done',
      ]),
    );
    const skipped = events.find((e) => e['event'] === 'skipped');
    expect(skipped?.['reasons']).toEqual({ stale: 1, digest: 1, site_name: 1 });
    expect(skipped?.['slot']).toBe(S0);
    const grouping = events.find((e) => e['event'] === 'grouping');
    expect(grouping?.['unplacedClusters']).toBeGreaterThan(0);
  });
});
