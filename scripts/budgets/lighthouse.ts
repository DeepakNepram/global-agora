/**
 * The Lighthouse budget (Prompt 5.2), after `npm run test:e2e:build`:
 *
 *   npm run budgets:lighthouse [-- --runs 5]
 *
 * Serves dist-e2e as Pages would (scripts/e2e/serve.ts: production headers,
 * the API answered from fixtures), audits the home page with Lighthouse's
 * desktop preset in Playwright's Chromium, and checks the median of the runs
 * against budgets.json. Each run's report goes to lighthouse-report/.
 *
 * WebGL is drawn on the CPU here (SwiftShader), as on a CI runner, so the
 * performance score is a floor that catches regressions in this setup, not a
 * number a reader's GPU would see. is-crawlable is skipped: the alpha is
 * noindex on purpose (public/_headers).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { extname, join } from 'node:path';

import { chromium, type Browser } from '@playwright/test';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

interface LighthouseBudget {
  readonly runs: number;
  /** Category scores, 0 to 1: the median must reach these. */
  readonly minScore: Readonly<Record<string, number>>;
  /** Audits' numeric values (ms, bytes, or unitless for CLS): the median must stay at or under. */
  readonly maxNumeric: Readonly<Record<string, number>>;
}

const DIST = 'dist-e2e';
// Not 4190: browsers refuse it (ManageSieve is on the fetch spec's bad-port list).
const SERVER_PORT = 4181;
const URL_UNDER_TEST = `http://localhost:${SERVER_PORT}/`;
const REPORTS = 'lighthouse-report';
/** WebGL without a GPU, as in playwright.config.ts. */
const SOFTWARE_GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(name);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

const budget = (
  JSON.parse(readFileSync('budgets.json', 'utf8')) as { lighthouse: LighthouseBudget }
).lighthouse;
const runs = Number(arg('--runs', String(budget.runs)));

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? NaN)
    : ((sorted[middle - 1] ?? NaN) + (sorted[middle] ?? NaN)) / 2;
}

/** A port the OS says is free: Windows reserves ranges a fixed choice can fall into. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port);
        else reject(new Error('no free port'));
      });
    });
  });
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(URL_UNDER_TEST)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the fixture server did not answer on ${URL_UNDER_TEST}`);
}

/**
 * An edge already holds compressed copies; the fixture server makes each on
 * its first request (seconds for the main chunk at Brotli 11), which would
 * land in the first run's timings and time out its source-map fetches.
 */
async function warmUp(): Promise<void> {
  const files = readdirSync(DIST, { recursive: true, encoding: 'utf8' })
    .filter((path) => extname(path) !== '')
    .map((path) => path.replaceAll('\\', '/'));
  for (const path of files) {
    const response = await fetch(`${URL_UNDER_TEST}${path}`, {
      headers: { 'accept-encoding': 'br' },
    });
    await response.arrayBuffer();
  }
}

const server = spawn(
  process.execPath,
  ['--experimental-strip-types', 'scripts/e2e/serve.ts', '--port', String(SERVER_PORT)],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
let browser: Browser | undefined;

const scores = new Map<string, number[]>();
const numbers = new Map<string, number[]>();
const failing = new Map<string, string>();
try {
  await waitForServer();
  await warmUp();
  const debugPort = await freePort();
  // Playwright's headless shell, as the e2e checks use: CI caches it already.
  browser = await chromium.launch({
    args: [`--remote-debugging-port=${debugPort}`, ...SOFTWARE_GL],
  });
  mkdirSync(REPORTS, { recursive: true });
  for (let run = 1; run <= runs; run++) {
    const result = await lighthouse(
      URL_UNDER_TEST,
      {
        port: debugPort,
        output: 'html',
        logLevel: 'error',
        onlyCategories: Object.keys(budget.minScore),
        skipAudits: ['is-crawlable'],
      },
      desktopConfig,
    );
    if (!result) throw new Error('Lighthouse returned nothing');
    const { lhr } = result;
    if (lhr.runtimeError) throw new Error(`Lighthouse: ${lhr.runtimeError.message}`);
    writeFileSync(join(REPORTS, `run-${run}.html`), String(result.report));

    for (const id of Object.keys(budget.minScore)) {
      scores.set(id, [...(scores.get(id) ?? []), lhr.categories[id]?.score ?? 0]);
    }
    for (const id of Object.keys(budget.maxNumeric)) {
      numbers.set(id, [...(numbers.get(id) ?? []), lhr.audits[id]?.numericValue ?? Infinity]);
    }
    // What pulled a category below a perfect score, for the log.
    for (const audit of Object.values(lhr.audits)) {
      if (audit.scoreDisplayMode === 'binary' && audit.score === 0) {
        failing.set(audit.id, audit.title);
      }
    }
    const performance = lhr.categories['performance']?.score ?? 0;
    console.log(`run ${run}/${runs}: performance ${Math.round(performance * 100)}`);
  }
} finally {
  await browser?.close();
  server.kill();
}

let over = 0;
console.log('');
for (const [id, min] of Object.entries(budget.minScore)) {
  const value = median(scores.get(id) ?? []);
  const ok = value >= min;
  if (!ok) over++;
  console.log(
    `${ok ? 'ok  ' : 'LOW '}  ${id.padEnd(26)} ${value.toFixed(2).padStart(10)}  min ${min}`,
  );
}
for (const [id, max] of Object.entries(budget.maxNumeric)) {
  const value = median(numbers.get(id) ?? []);
  const ok = value <= max;
  if (!ok) over++;
  const shown = value < 1 ? value.toFixed(3) : String(Math.round(value));
  console.log(`${ok ? 'ok  ' : 'OVER'}  ${id.padEnd(26)} ${shown.padStart(10)}  max ${max}`);
}
if (failing.size > 0) {
  console.log('\nFailed audits in some run:');
  for (const [id, title] of failing) console.log(`  ${id}: ${title}`);
}
if (over > 0) {
  console.error(
    `\n${over} outside budget (budgets.json; reports in ${REPORTS}/). Fix it, or change the budget with a reason in docs/DECISIONS.md.`,
  );
  process.exitCode = 1;
} else {
  console.log(`\nWithin budget (median of ${runs}).`);
}
