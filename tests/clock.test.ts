import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guard for the rule in Prompt 1.2: "do not hardcode the current time anywhere
 * in the render path."
 *
 * Everything that depends on time renders the time store's value; only
 * src/state/clock.ts may read the wall clock. ESLint enforces this too, but a
 * lint rule can be silenced with one comment. This test reads the source text,
 * so a stray Date.now() in a shader uniform update fails CI regardless.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(repoRoot, 'src');
const ALLOWED = new Set(['src/state/clock.ts']);

/** Date.now(), performance.now(), new Date() and Date() with no argument. */
const CLOCK_READ_RE =
  /\bDate\s*\.\s*now\s*\(|\bperformance\s*\.\s*now\s*\(|\bnew\s+Date\b\s*(?:\(\s*\)|(?![\s(]))|(?<![\w.]|new\s)Date\s*\(\s*\)/g;

function sourceFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesIn(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function clockReadsIn(source: string): string[] {
  return [...stripComments(source).matchAll(CLOCK_READ_RE)].map((m) => m[0].trim());
}

describe('wall-clock reads', () => {
  it('happen only in src/state/clock.ts', () => {
    const offenders = sourceFilesIn(srcDir).flatMap((file) => {
      const path = relative(repoRoot, file).replaceAll(sep, '/');
      if (ALLOWED.has(path)) return [];
      return clockReadsIn(readFileSync(file, 'utf8')).map((read) => `${path}: ${read}`);
    });
    expect(offenders).toEqual([]);
  });

  it('detects a clock read when one exists', () => {
    // Guards the guard: a detector that stopped matching would pass forever.
    expect(clockReadsIn('const t = Date.now();')).toHaveLength(1);
    expect(clockReadsIn('const t = performance.now();')).toHaveLength(1);
    expect(clockReadsIn('const d = new Date();')).toHaveLength(1);
    expect(clockReadsIn('const d = new Date;')).toHaveLength(1);
    expect(clockReadsIn('const s = Date();')).toHaveLength(1);

    expect(clockReadsIn('const d = new Date(timeMs);')).toEqual([]);
    expect(clockReadsIn('const d = new DateTimeFormat;')).toEqual([]);
    expect(clockReadsIn('const t = Date.UTC(2026, 0, 1);')).toEqual([]);
    expect(clockReadsIn('// Date.now() in a comment')).toEqual([]);
    expect(clockReadsIn('const u = "https://example.com"; const d = new Date(ms);')).toEqual([]);
  });
});
