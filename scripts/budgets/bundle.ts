/**
 * The bundle budget (Prompt 5.2), after `npm run build`:
 *
 *   npm run budgets:bundle            checks dist/ against budgets.json
 *
 * Fails when:
 * - the page starts with more than one script or stylesheet (rolldown has
 *   split shared modules into extra startup files before: DECISIONS, 5.1 and
 *   5.2);
 * - the start's script or styles, a named lazy chunk, or everything the
 *   service worker precaches is over its gzip budget.
 *
 * Budgets are the sizes when they were set plus about 2%; raising one is a
 * decision, written down in docs/DECISIONS.md.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

interface Budgets {
  readonly startupFiles: { readonly js: number; readonly css: number };
  readonly gzipKB: {
    readonly entry: number;
    readonly css: number;
    readonly precache: number;
    readonly chunks: Readonly<Record<string, number>>;
  };
}

const DIST = process.argv[2] ?? 'dist';
const budgets = JSON.parse(readFileSync('budgets.json', 'utf8')) as Budgets;
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const assets = readdirSync(join(DIST, 'assets')).filter((name) => !name.endsWith('.map'));

// Kilobytes of 1000 bytes, gzip level 9: the figures Vite's build output prints.
const kb = (bytes: number): number => Math.round(bytes / 10) / 100;
const gzipKB = (path: string): number =>
  kb(gzipSync(readFileSync(join(DIST, path)), { level: 9 }).length);

interface Row {
  readonly what: string;
  readonly actual: number;
  readonly budget: number;
  readonly unit: string;
}
const rows: Row[] = [];

// The start: the entry script, every modulepreload, every stylesheet.
const scripts = [...html.matchAll(/<script[^>]+src="\/([^"]+\.js)"/g)].map((m) => m[1] ?? '');
const preloads = [...html.matchAll(/rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(
  (m) => m[1] ?? '',
);
const styles = [...html.matchAll(/rel="stylesheet"[^>]*href="\/([^"]+)"/g)].map((m) => m[1] ?? '');
rows.push({
  what: 'startup scripts',
  actual: scripts.length + preloads.length,
  budget: budgets.startupFiles.js,
  unit: 'files',
});
rows.push({
  what: 'startup stylesheets',
  actual: styles.length,
  budget: budgets.startupFiles.css,
  unit: 'files',
});
const entry = scripts[0];
if (entry)
  rows.push({ what: entry, actual: gzipKB(entry), budget: budgets.gzipKB.entry, unit: 'KB gzip' });
const css = styles[0];
if (css) rows.push({ what: css, actual: gzipKB(css), budget: budgets.gzipKB.css, unit: 'KB gzip' });

// Named lazy chunks: "<name>-<hash>.js".
for (const [name, budget] of Object.entries(budgets.gzipKB.chunks)) {
  const file = assets.find((asset) => asset.startsWith(`${name}-`) && asset.endsWith('.js'));
  rows.push({
    what: file ? `assets/${file}` : `assets/${name}-*.js (missing)`,
    actual: file ? gzipKB(`assets/${file}`) : Number.POSITIVE_INFINITY,
    budget,
    unit: 'KB gzip',
  });
}

// What a first visit's service worker downloads at install.
const sw = readFileSync(join(DIST, 'sw.js'), 'utf8');
const listed = /new Set\(\[([^\]]*)\]/.exec(sw)?.[1] ?? '';
const precached = [...listed.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
const precacheTotal = precached.reduce((sum, file) => sum + gzipKB(file), 0);
rows.push({
  what: `precache (${precached.length} files)`,
  actual: Math.round(precacheTotal * 100) / 100,
  budget: budgets.gzipKB.precache,
  unit: 'KB gzip',
});

let failed = 0;
for (const row of rows) {
  const over = row.actual > row.budget;
  if (over) failed++;
  const actual = Number.isFinite(row.actual) ? String(row.actual) : '—';
  console.log(
    `${over ? 'OVER' : 'ok  '}  ${row.what.padEnd(46)} ${actual.padStart(8)} / ${String(row.budget).padStart(6)} ${row.unit}`,
  );
}
if (failed > 0) {
  console.error(
    `\n${failed} over budget (budgets.json). Shrink it, or raise the budget with a reason in docs/DECISIONS.md.`,
  );
  process.exitCode = 1;
} else {
  console.log('\nWithin budget.');
}
