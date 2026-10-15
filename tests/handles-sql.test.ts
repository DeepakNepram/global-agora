import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HANDLE_PATTERN, RESERVED_HANDLE_PREFIXES, RESERVED_HANDLES } from '../src/core/handles';

/**
 * The handle rules live in the database (the authority) and in
 * src/core/handles.ts (instant feedback while typing). These fail when one
 * changes without the other.
 */

const sql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../supabase/migrations/20261016100000_profiles.sql',
  ),
  'utf8',
);

/** The quoted words of the n-th `array[...]` inside handle_reserved. */
function reservedArray(index: number): string[] {
  const body = /create function public\.handle_reserved[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)?.[1];
  const arrays = [...(body ?? '').matchAll(/array\[([\s\S]*?)\]/g)].map((m) => m[1] ?? '');
  return [...(arrays[index] ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '');
}

describe('handle rules', () => {
  it('reserve the same exact words in SQL and TypeScript', () => {
    expect(reservedArray(0)).toEqual([...RESERVED_HANDLES]);
  });

  it('reserve the same prefixes', () => {
    expect(reservedArray(1)).toEqual([...RESERVED_HANDLE_PREFIXES]);
  });

  it('use the same pattern everywhere in the migration', () => {
    const patterns = new Set([...sql.matchAll(/~ '(\^[^']*)'/g)].map((m) => m[1]));
    expect([...patterns]).toEqual([HANDLE_PATTERN.source]);
  });
});
