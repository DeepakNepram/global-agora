import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guard for Prompt 3.2: "History depth must be a config value, not a literal
 * 24 anywhere in the code." The window is AppConfig.historyWindowHours, a tier
 * boundary (CLAUDE.md: never hardcode one); its free-tier default in
 * src/core/config.ts is the only 24 allowed in client code. Comments are
 * stripped first, so prose about "the last 24 hours" is fine; a string a user
 * reads is not, because that must say the configured number.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(repoRoot, 'src');
const ALLOWED = new Map([['src/core/config.ts', 1]]);

/** A standalone 24: not part of 0.24, 1024, 24px or an identifier. */
const LITERAL_24_RE = /(?<![\w.])24(?![\w.])/g;

function sourceFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesIn(full);
    return /\.tsx?$/.test(entry.name) && !/\.(test|fixture)\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function literalsIn(source: string): number {
  return [...stripComments(source).matchAll(LITERAL_24_RE)].length;
}

describe('history depth', () => {
  it('is written as 24 only as the config default', () => {
    const offenders = sourceFilesIn(srcDir).flatMap((file) => {
      const path = relative(repoRoot, file).replaceAll(sep, '/');
      const found = literalsIn(readFileSync(file, 'utf8'));
      return found > (ALLOWED.get(path) ?? 0) ? [`${path}: ${found}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('detects a literal 24 when one exists', () => {
    // Guards the guard: a detector that stopped matching would pass forever.
    expect(literalsIn('const hours = 24;')).toBe(1);
    expect(literalsIn("label = 'Play the last 24 hours';")).toBe(1);
    expect(literalsIn('const ms = 24 * 3600 * 1000;')).toBe(1);

    expect(literalsIn('// the last 24 hours')).toBe(0);
    expect(literalsIn('const a = 0.24, b = 1024, c = 24px;')).toBe(0);
    expect(literalsIn('const hours = config.historyWindowHours;')).toBe(0);
  });
});
