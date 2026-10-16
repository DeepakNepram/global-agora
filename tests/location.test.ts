import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md #5: no GPS, no location prompt, ever. ESLint bans the
 * `geolocation` property in src/, but a lint rule can be silenced with one
 * comment; this reads the source text. The deployed pages also tell the
 * browser to refuse any location request outright (public/_headers).
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesIn(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('no device location (CLAUDE.md #5)', () => {
  it('the app never touches the Geolocation API', () => {
    const offenders = sourceFilesIn(resolve(repoRoot, 'src')).filter((file) =>
      /\bgeolocation\b|getCurrentPosition|watchPosition/i.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((file) => relative(repoRoot, file))).toEqual([]);
  });

  it('every page is served with geolocation switched off', () => {
    const headers = readFileSync(resolve(repoRoot, 'public/_headers'), 'utf8');
    expect(headers).toMatch(/^\/\*\n\s+Permissions-Policy: geolocation=\(\)$/m);
  });
});
