import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { REGION_LABEL_MAX } from '../src/core/localBadge';
import { POST_KINDS } from '../src/core/posting';

/**
 * The app and the database must agree on the post kinds and the region
 * label's length, or a post fails a CHECK the composer never warned about.
 */
function migration(name: string): string {
  return readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
}

describe('posting, app and database', () => {
  it('lists the same four post kinds', () => {
    const sql = migration('20260924100200_discussions.sql');
    const list = /kind\s+text not null check \(kind in \(([^)]*)\)\)/.exec(sql)?.[1] ?? '';
    expect([...list.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...POST_KINDS]);
  });

  it('caps the region label at the same length', () => {
    const sql = migration('20260924100200_discussions.sql');
    expect(sql).toMatch(
      new RegExp(
        `region_label\\s+text check \\(char_length\\(region_label\\) <= ${REGION_LABEL_MAX}\\)`,
      ),
    );
  });
});
