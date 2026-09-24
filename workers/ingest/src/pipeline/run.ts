/**
 * One ingest run: pick slots, and for each one fetch, normalize, de-duplicate,
 * group, score and write it; then prune. Every step logs one structured line.
 *
 * Slots come from our own ledger, not the manifest: the manifest names files
 * about an hour before they exist, so the run walks forward from the last
 * slot it finished and stops at the first one that is not published yet.
 */

import type { Json } from '../../../../src/core/db/types.ts';
import type { IngestConfig } from '../config.ts';
import type { IngestDb, PruneResult } from '../db/service.ts';
import { clusterWriteups, groupWriteups } from '../dedup/cluster.ts';
import type { Feed, Fetch } from '../gdelt/feed.ts';
import { parseGkg } from '../gdelt/gkg.ts';
import {
  isSlot,
  nextSlot,
  previousSlot,
  slotAt,
  slotFromIso,
  slotIso,
  slotSeconds,
} from '../gdelt/slots.ts';
import { errorFields, type Logger } from '../../../shared/log.ts';
import type { OutletCountry } from '../normalize/outlets.ts';

import { clusterKeys, planBatch } from './plan.ts';
import { prepareArticles } from './prepare.ts';

export interface RunDeps {
  readonly feed: Feed;
  readonly db: IngestDb;
  readonly fetch: Fetch;
  readonly outletCountry: OutletCountry;
  readonly config: IngestConfig;
  readonly log: Logger;
  /** Epoch seconds. */
  readonly now: () => number;
  readonly newId: () => string;
}

export interface RunOptions {
  readonly trigger: 'cron' | 'manual';
  /** Process exactly this slot (manual runs). */
  readonly slot?: string;
  /** Compute everything, write nothing. */
  readonly dryRun?: boolean;
}

export type SlotStatus = 'done' | 'dry_run' | 'skipped' | 'failed' | 'busy' | 'not_published';

export interface SlotSummary {
  readonly slot: string;
  readonly status: SlotStatus;
  readonly counts?: Record<string, number | Record<string, number>>;
  readonly hottest?: { title: string; heat: number; sources: number }[];
}

export interface RunSummary {
  readonly slots: SlotSummary[];
  readonly prune?: PruneResult;
  readonly durationMs: number;
}

/** How far back from the manifest to look for the newest file that exists. */
const MANIFEST_WALK_BACK = 12;
const FEED_LAG_MARGIN_HOURS = 2;

async function newestPublished(deps: RunDeps): Promise<string | null> {
  let slot = await deps.feed.latestListedSlot();
  for (let i = 0; i < MANIFEST_WALK_BACK; i++) {
    if (await deps.feed.hasSlot(slot)) return slot;
    slot = previousSlot(slot);
  }
  return null;
}

/** The slots this run should try, in order. */
async function pendingSlots(deps: RunDeps): Promise<string[]> {
  const { config, log } = deps;
  const cursor = await deps.db.cursor();
  if (cursor === null) {
    const newest = await newestPublished(deps);
    log.info('slot.first_run', { newest });
    return newest === null ? [] : [newest];
  }

  const now = deps.now();
  let next = nextSlot(slotFromIso(cursor));
  if (slotSeconds(next) < now - config.maxLagHours * 3600) {
    const newest = await newestPublished(deps);
    log.warn('slot.gap', { from: next, to: newest, maxLagHours: config.maxLagHours });
    return newest === null ? [] : [newest];
  }

  const latest = slotAt(now);
  const slots: string[] = [];
  while (slots.length < config.maxSlotsPerRun && slotSeconds(next) <= slotSeconds(latest)) {
    slots.push(next);
    next = nextSlot(next);
  }
  return slots;
}

async function processSlot(
  deps: RunDeps,
  slot: string,
  dryRun: boolean,
  runLog: Logger,
): Promise<SlotSummary> {
  const log = runLog.child({ slot });
  const { db, feed, config } = deps;
  const at = slotIso(slot);

  if (!(await feed.hasSlot(slot))) {
    const lateBy = deps.now() - slotSeconds(slot);
    if (lateBy > config.missingAfterMinutes * 60 && !dryRun) {
      await db.finish(at, 'skipped', { reason: 'missing' });
      log.warn('slot.missing', { lateMinutes: Math.round(lateBy / 60) });
      return { slot, status: 'skipped' };
    }
    log.info('slot.not_published');
    return { slot, status: 'not_published' };
  }
  if (!dryRun && !(await db.claim(at))) {
    log.info('slot.busy');
    return { slot, status: 'busy' };
  }
  log.info('slot.claimed', { dryRun });

  const counts: Record<string, number | Record<string, number>> = {};
  try {
    let mark = Date.now();
    const ms = (): number => {
      const now = Date.now();
      const elapsed = now - mark;
      mark = now;
      return elapsed;
    };
    const file = await feed.fetchSlot(slot);
    if (file === null) throw new Error('slot disappeared between HEAD and GET');
    log.info('feed.fetched', { bytes: file.bytes, chars: file.text.length, ms: ms() });

    const parsed = parseGkg(file.text);
    const prepared = await prepareArticles(parsed.records, {
      db,
      fetch: deps.fetch,
      outletCountry: deps.outletCountry,
      redirectBudget: config.redirectBudget,
      // GKG files arrive about an hour late; two hours of margin means a story
      // is never written only to be pruned at the end of the same run.
      maxAgeSec: (config.retentionHours - FEED_LAG_MARGIN_HOURS) * 3600,
    });
    const { writeups, sameOutletDuplicates } = groupWriteups(prepared.articles);
    const dedup = {
      redirectsResolved: prepared.redirectsResolved,
      urlDuplicates: prepared.urlDuplicates,
      knownUrls: prepared.knownUrls,
      sameOutletDuplicates,
      writeups: writeups.length,
    };
    Object.assign(counts, { rows: parsed.records.length, malformed: parsed.malformed }, dedup, {
      skipped: prepared.skipped,
    });
    log.info('parse', {
      rows: parsed.records.length,
      malformed: parsed.malformed,
      articles: prepared.articles.length,
    });
    log.info('skipped', { reasons: prepared.skipped, sampleUrls: prepared.sampleUrls });
    log.info('dedup', { ...dedup, ms: ms() });

    const clusters = clusterWriteups(writeups);
    const since = new Date(
      (slotSeconds(slot) - config.matchWindowHours * 3600) * 1000,
    ).toISOString();
    const lookups = clusters
      .map((cluster, i) => ({ i, keys: clusterKeys(cluster) }))
      .filter((lookup) => lookup.keys.length >= 2);
    const candidates = await db.candidates(lookups, since);
    const candidatesMs = ms();
    const plan = planBatch({
      batchTime: slotSeconds(slot),
      clusters,
      candidates,
      queueHeat: config.queueHeat,
      heat: config.heat,
      newId: deps.newId,
    });
    Object.assign(counts, plan.stats);
    log.info('grouping', { candidates: candidates.length, candidatesMs, ...plan.stats, ms: ms() });
    log.info('heat', {
      queueHeat: config.queueHeat,
      queued: plan.stats.queued,
      hottest: plan.hottest,
    });

    if (dryRun) return { slot, status: 'dry_run', counts, hottest: plan.hottest };

    const result = await db.apply({
      slot: at,
      counts: counts as Json,
      stories: plan.stories,
      signals: plan.signals,
      articles: plan.articles,
    } as unknown as Json);
    log.info('db.applied', { ...result, ms: ms() });
    return { slot, status: 'done', counts: { ...counts, ...result }, hottest: plan.hottest };
  } catch (error) {
    log.error('slot.failed', errorFields(error));
    if (!dryRun) {
      try {
        const message = error instanceof Error ? error.message : String(error);
        await db.finish(at, 'failed', counts as Json, message);
      } catch (finishError) {
        log.error('slot.finish_failed', errorFields(finishError));
      }
    }
    return { slot, status: 'failed', counts };
  }
}

export async function runIngest(deps: RunDeps, options: RunOptions): Promise<RunSummary> {
  const started = Date.now();
  const log = deps.log;
  const dryRun = options.dryRun === true;
  log.info('run.start', { trigger: options.trigger, dryRun, slot: options.slot ?? null });

  if (options.slot !== undefined && !isSlot(options.slot)) {
    throw new Error(`not a GDELT slot: ${options.slot}`);
  }
  const slots = options.slot !== undefined ? [options.slot] : await pendingSlots(deps);

  const summaries: SlotSummary[] = [];
  for (const slot of slots) {
    const summary = await processSlot(deps, slot, dryRun, log);
    summaries.push(summary);
    if (summary.status !== 'done' && summary.status !== 'skipped' && summary.status !== 'dry_run')
      break;
  }

  let prune: PruneResult | undefined;
  if (!dryRun) {
    const now = deps.now();
    const ago = (seconds: number): string => new Date((now - seconds) * 1000).toISOString();
    prune = await deps.db.prune(
      ago(deps.config.retentionHours * 3600),
      ago(deps.config.runRetentionDays * 86400),
      // Candidates are only looked up within the match window.
      ago(deps.config.matchWindowHours * 3600),
    );
    log.info('prune', { ...prune });
  }

  const durationMs = Date.now() - started;
  log.info('run.done', { durationMs, slots: summaries.map((s) => `${s.slot}:${s.status}`) });
  return { slots: summaries, ...(prune === undefined ? {} : { prune }), durationMs };
}
