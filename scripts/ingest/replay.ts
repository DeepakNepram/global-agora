/**
 * Replays the ingest over consecutive real GDELT slots, in memory, and reports
 * what it would do: skip reasons, grouping, heat, the queue, categories, and
 * CPU per slot. The calibration numbers in docs/DECISIONS.md come from here.
 *
 *   npm run ingest:replay -- [--slots 8] [--end YYYYMMDDHHMMSS] [--queue-heat 215]
 *                            [--saturation 19,7,15]
 *
 * It runs the Worker's own pipeline (runIngest) against an in-memory copy of
 * the database functions, so nothing needs Supabase and nothing is written.
 * CPU is process CPU time around each slot, which excludes waiting on the
 * download: the figure that counts against a Worker's CPU limit.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NEWS_CATEGORIES } from '../../src/core/nodeBuffer.ts';
import { DEFAULT_CONFIG, type IngestConfig } from '../../workers/ingest/src/config.ts';
import { createFeed, type Feed } from '../../workers/ingest/src/gdelt/feed.ts';
import { previousSlot, slotSeconds } from '../../workers/ingest/src/gdelt/slots.ts';
import { createLogger } from '../../workers/ingest/src/log.ts';
import { createOutletCountries } from '../../workers/ingest/src/normalize/outlets.ts';
import { runIngest } from '../../workers/ingest/src/pipeline/run.ts';

import { createMemoryDb } from './memory-db.ts';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function triple(value: string | undefined): [number, number, number] | undefined {
  const parts = value?.split(',').map(Number);
  return parts?.length === 3 && parts.every(Number.isFinite)
    ? [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
    : undefined;
}

/** Slots are cached in the OS temp directory, so trying settings does not re-download. */
function cachedFeed(): Feed {
  const live = createFeed(DEFAULT_CONFIG.gdeltBaseUrl);
  const dir = join(tmpdir(), 'global-agora-gkg');
  mkdirSync(dir, { recursive: true });
  return {
    latestListedSlot: () => live.latestListedSlot(),
    hasSlot: async (slot) => existsSync(join(dir, `${slot}.tsv`)) || live.hasSlot(slot),
    fetchSlot: async (slot) => {
      const file = join(dir, `${slot}.tsv`);
      if (existsSync(file)) {
        const text = readFileSync(file, 'utf8');
        return { text, bytes: text.length };
      }
      const fetched = await live.fetchSlot(slot);
      if (fetched !== null) writeFileSync(file, fetched.text);
      return fetched;
    },
  };
}

const feed = cachedFeed();
const count = Number(arg('--slots') ?? '8');
const saturation = triple(arg('--saturation'));
const config: IngestConfig = {
  ...DEFAULT_CONFIG,
  queueHeat: Number(arg('--queue-heat') ?? DEFAULT_CONFIG.queueHeat),
  heat:
    saturation === undefined
      ? DEFAULT_CONFIG.heat
      : {
          ...DEFAULT_CONFIG.heat,
          saturation: { sources: saturation[0], countries: saturation[1], velocity: saturation[2] },
        },
};

let end = arg('--end');
if (end === undefined) {
  end = await feed.latestListedSlot();
  while (!(await feed.hasSlot(end))) end = previousSlot(end);
}
const slots: string[] = [end];
while (slots.length < count) slots.unshift(previousSlot(slots[0] ?? end));

/**
 * CPU spent inside the in-memory database is subtracted from each slot: in
 * production that work runs in Postgres, not in the Worker, and the naive
 * in-memory candidate scan would otherwise dominate the figure.
 */
const memory = createMemoryDb();
let dbCpuMicros = 0;
const db: typeof memory = { ...memory };
for (const name of [
  'cursor',
  'claim',
  'finish',
  'knownUrls',
  'candidates',
  'apply',
  'prune',
] as const) {
  const original = memory[name] as (...args: unknown[]) => Promise<unknown>;
  Object.assign(db, {
    [name]: async (...args: unknown[]): Promise<unknown> => {
      const start = process.cpuUsage();
      try {
        return await original(...args);
      } finally {
        const used = process.cpuUsage(start);
        dbCpuMicros += used.user + used.system;
      }
    },
  });
}
const outletCountry = createOutletCountries(
  readFileSync(
    new URL('../../workers/ingest/src/data/outlet-countries.txt', import.meta.url),
    'utf8',
  ),
);
const skipped: Record<string, number> = {};
const cpuPerSlot: number[] = [];
let ids = 0;

const k = config.heat.saturation;
console.log(
  `Replaying ${slots.length} slots, ${slots[0]} to ${end} UTC, queue heat ${config.queueHeat}, ` +
    `saturation ${k.sources},${k.countries},${k.velocity}\n`,
);
console.log('slot            rows  new  upd  queued  unplaced  worker cpu ms');

for (const slot of slots) {
  const cpu = process.cpuUsage();
  dbCpuMicros = 0;
  const summary = await runIngest(
    {
      feed,
      db,
      fetch,
      outletCountry,
      config,
      log: createLogger({}, () => {}),
      // As the Worker would see it: an hour after the slot, when GKG files appear.
      now: () => slotSeconds(slot) + 3600,
      newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    },
    { trigger: 'manual', slot },
  );
  const used = process.cpuUsage(cpu);
  const ms = Math.round((used.user + used.system - dbCpuMicros) / 1000);
  cpuPerSlot.push(ms);
  const counts = summary.slots[0]?.counts ?? {};
  const n = (key: string): string => String(typeof counts[key] === 'number' ? counts[key] : 0);
  const reasons = counts['skipped'];
  if (typeof reasons === 'object') {
    for (const [reason, value] of Object.entries(reasons)) {
      skipped[reason] = (skipped[reason] ?? 0) + value;
    }
  }
  console.log(
    `${slot}  ${n('rows').padStart(4)}  ${n('stories_new').padStart(3)}  ` +
      `${n('stories_updated').padStart(3)}  ${n('queued').padStart(6)}  ` +
      `${n('unplacedClusters').padStart(8)}  ${String(ms).padStart(6)}`,
  );
}

const stories = [...db.stories.values()];
const sorted = [...cpuPerSlot].sort((a, b) => a - b);
console.log(`\n${stories.length} stories, ${db.articles.size} articles`);
console.log(
  `CPU per slot: median ${sorted[sorted.length >> 1]} ms, max ${sorted.at(-1)} ms ` +
    '(includes JIT warm-up on the first slot)',
);
console.log('skipped rows:', skipped);

console.log('\nheat');
const buckets = [0, 32, 64, 96, 128, 160, 192, config.queueHeat, 256];
for (let i = 0; i + 1 < buckets.length; i++) {
  const lo = buckets[i] ?? 0;
  const hi = buckets[i + 1] ?? 256;
  const n = stories.filter((s) => s.heat >= lo && s.heat < hi).length;
  console.log(`  ${String(lo).padStart(3)}-${String(hi - 1).padEnd(3)} ${String(n).padStart(5)}`);
}
console.log(`  at 255   ${String(stories.filter((s) => s.heat === 255).length).padStart(5)}`);

console.log('\ncategories');
NEWS_CATEGORIES.forEach((name, i) => {
  const n = stories.filter((s) => s.category === i).length;
  const share = ((100 * n) / Math.max(1, stories.length)).toFixed(0);
  console.log(`  ${name.padEnd(9)} ${String(n).padStart(5)}  ${share}%`);
});

const queued = stories.filter((s) => s.discussion_state === 'queued');
console.log(`\nqueued (heat >= ${config.queueHeat}): ${queued.length}`);
for (const s of queued.sort((a, b) => b.heat - a.heat)) {
  const state = db.signals.get(s.id)?.state;
  console.log(
    `  ${String(s.heat).padStart(3)}  ${String(s.source_count).padStart(3)} src ` +
      `${String(state?.w ?? 0).padStart(3)} wu ${String(state?.countries.length ?? 0).padStart(2)} ` +
      `ctry  ${s.title.slice(0, 58)}`,
  );
}
