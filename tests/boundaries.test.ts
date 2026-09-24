import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Architectural guard for the rule in CLAUDE.md:
 *
 *   "src/globe/ and src/core/ must never import from src/ui/. This boundary is
 *    what makes the later native port possible. Do not cross it."
 *
 * ESLint already enforces this, but a lint rule can be silenced with one
 * `eslint-disable` comment. This test reads the source text directly, so the
 * boundary fails CI whether or not the linter was persuaded to look away.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = resolve(repoRoot, 'src', 'ui');

/** Matches `from '…'`, `import '…'`, `import('…')` and `require('…')`. */
const SPECIFIER_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

function sourceFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesIn(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function pointsAtUi(specifier: string, importingFile: string): boolean {
  if (/^@\/ui(\/|$)/.test(specifier) || /^src\/ui(\/|$)/.test(specifier)) return true;

  if (specifier.startsWith('.')) {
    const target = resolve(dirname(importingFile), specifier);
    return target === uiDir || target.startsWith(uiDir + sep);
  }

  return false;
}

function uiImportsIn(layer: string): string[] {
  const layerDir = resolve(repoRoot, 'src', layer);

  return sourceFilesIn(layerDir).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const offenders: string[] = [];

    for (const match of source.matchAll(SPECIFIER_RE)) {
      const specifier = match[1];
      if (specifier !== undefined && pointsAtUi(specifier, file)) {
        offenders.push(`${relative(repoRoot, file).replaceAll(sep, '/')} imports '${specifier}'`);
      }
    }

    return offenders;
  });
}

/** Files outside src/core/db that import the Supabase SDK. */
function supabaseImportsOutsideDb(): string[] {
  const dbDir = resolve(repoRoot, 'src', 'core', 'db');

  return sourceFilesIn(resolve(repoRoot, 'src'))
    .filter((file) => !file.startsWith(dbDir + sep))
    .flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(SPECIFIER_RE)]
        .map((match) => match[1])
        .filter((specifier) => specifier?.startsWith('@supabase/'))
        .map(
          (specifier) => `${relative(repoRoot, file).replaceAll(sep, '/')} imports '${specifier}'`,
        ),
    );
}

describe('layer boundaries', () => {
  it.each(['globe', 'core'])('src/%s does not import from src/ui', (layer) => {
    expect(uiImportsIn(layer)).toEqual([]);
  });

  it('only src/core/db imports the Supabase SDK', () => {
    expect(supabaseImportsOutsideDb()).toEqual([]);
  });

  it('no client code names a service-role key (CLAUDE.md #9)', () => {
    // Service keys live in Workers. Any mention under src/ is a key on its way
    // into the public bundle.
    const offenders = sourceFilesIn(resolve(repoRoot, 'src'))
      .filter((file) => /SERVICE_ROLE_KEY/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repoRoot, file).replaceAll(sep, '/'));
    expect(offenders).toEqual([]);
  });

  it('detects a violation when one exists', () => {
    // Guards the guard: if the detector silently stopped matching, the two tests
    // above would pass vacuously forever.
    expect(pointsAtUi('@/ui/App', resolve(repoRoot, 'src/core/x.ts'))).toBe(true);
    expect(pointsAtUi('../ui/App', resolve(repoRoot, 'src/core/x.ts'))).toBe(true);
    expect(pointsAtUi('../../ui/App', resolve(repoRoot, 'src/core/deep/x.ts'))).toBe(true);
    expect(pointsAtUi('src/ui/App', resolve(repoRoot, 'src/core/x.ts'))).toBe(true);
    expect(pointsAtUi('@/core/config', resolve(repoRoot, 'src/globe/x.ts'))).toBe(false);
  });
});
