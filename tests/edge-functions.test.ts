import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Edge Functions import no packages: they call the models with fetch, so
 * they start without downloading anything (docs/DECISIONS.md, Prompts 4.3
 * and 4.6). Backs up the ESLint rule in case a line silences it.
 */
const FUNCTIONS = new URL('../supabase/functions/', import.meta.url);

const files = (): string[] =>
  readdirSync(FUNCTIONS, { recursive: true, encoding: 'utf8' }).map((file) =>
    file.replaceAll('\\', '/'),
  );

describe('Edge Functions', () => {
  it('import nothing from npm or a URL, only each other', () => {
    const sources = files().filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(0);
    const imports = /^\s*import\s[^;]*?from\s+'([^']+)'/gm;
    const outside = sources.flatMap((file) =>
      [...readFileSync(new URL(file, FUNCTIONS), 'utf8').matchAll(imports)]
        .map((match) => match[1] ?? '')
        .filter((specifier) => !specifier.startsWith('.'))
        .map((specifier) => `${file}: ${specifier}`),
    );
    expect(outside).toEqual([]);
  });

  it('have no import map that could bring a package in', () => {
    expect(files().filter((file) => /(^|\/)(deno|import_map)\.jsonc?$/.test(file))).toEqual([]);
  });
});
