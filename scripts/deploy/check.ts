/**
 * Before a deploy build (Prompt 5.2):
 *
 *   npm run deploy:check
 *
 * Loads the variables exactly as `vite build` will for production (.env,
 * .env.local, .env.production, .env.production.local, then the shell; later
 * wins) and checks each without printing it. .env.local holds the local
 * stack's values and is read in production too, so anything
 * .env.production.local leaves out comes from there: the deploy runbook's
 * trap, caught here.
 *
 * Also checks what a direct upload needs on disk (the textures, which are
 * gitignored) and whether source maps will reach Sentry. Exits 1 on any error.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadEnv } from 'vite';

import { checkProductionEnv, connectSources, type Finding } from './checks.ts';

const headers = readFileSync('public/_headers', 'utf8');
const findings: Finding[] = checkProductionEnv(
  loadEnv('production', process.cwd(), 'VITE_'),
  connectSources(headers),
);

// Textures are gitignored (DECISIONS, 2026-09-12): a build without them
// deploys a globe with no Earth.
const manifest = JSON.parse(readFileSync('public/textures/manifest.json', 'utf8')) as {
  tiers: Record<string, { layers: Record<string, { file: string }> }>;
};
const textures = Object.values(manifest.tiers).flatMap((tier) =>
  Object.values(tier.layers).map((layer) => layer.file),
);
const absent = textures.filter((file) => !existsSync(join('public/textures', file)));
findings.push(
  absent.length === 0
    ? { key: 'textures', level: 'ok', note: `${textures.length} files in public/textures` }
    : {
        key: 'textures',
        level: 'error',
        note: `${absent.length} missing: npm run textures`,
      },
);

const uploads =
  existsSync('.env.sentry-build-plugin') || (process.env['SENTRY_AUTH_TOKEN'] ?? '') !== '';
findings.push(
  uploads
    ? { key: 'source maps', level: 'ok', note: 'uploaded to Sentry by the build' }
    : {
        key: 'source maps',
        level: 'warn',
        note: 'no .env.sentry-build-plugin: Sentry shows minified stack traces',
      },
);

findings.push(
  /X-Robots-Tag:\s*noindex/i.test(headers)
    ? { key: 'indexing', level: 'ok', note: 'noindex, as the alpha wants; remove at public launch' }
    : { key: 'indexing', level: 'ok', note: 'search engines may index the site' },
);

const MARK: Readonly<Record<Finding['level'], string>> = {
  ok: 'ok  ',
  warn: 'WARN',
  error: 'FAIL',
};
for (const finding of findings) {
  console.log(`${MARK[finding.level]}  ${finding.key.padEnd(24)} ${finding.note}`);
}
const errors = findings.filter((finding) => finding.level === 'error').length;
if (errors > 0) {
  console.error(
    `\n${errors} to fix before building for production (values go in .env.production.local).`,
  );
  process.exitCode = 1;
} else {
  console.log('\nReady to build: npm run build');
}
