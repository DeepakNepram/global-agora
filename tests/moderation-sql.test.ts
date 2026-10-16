import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { REPORT_REASONS } from '../src/core/moderation';

/**
 * The app and the database must agree on the report reasons and the notice
 * kinds, or a report fails its CHECK, or a notice is never shown.
 */
function migration(name: string): string {
  return readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
}

function checkList(sql: string, constraint: RegExp): string[] {
  const list = sql.match(constraint)?.[1];
  if (list === undefined) throw new Error(`no ${constraint.source}`);
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

describe('moderation, app and database', () => {
  it('lists the same six report reasons', () => {
    const sql = migration('20261017110000_reports_blocks.sql');
    const reasons = checkList(sql, /reports_reason_known\s+check \(reason in \(([^)]*)\)\)/);
    expect(REPORT_REASONS.map((reason) => reason.id)).toEqual(reasons);
  });

  it('knows every notice kind the database writes', () => {
    const sql = migration('20261017100000_moderation.sql');
    const kinds = checkList(sql, /kind\s+text not null check \(kind in \(([^)]*)\)\)/);
    expect(kinds.sort()).toEqual(['post_removed', 'report_outcome']);
  });
});
