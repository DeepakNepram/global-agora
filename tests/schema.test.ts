import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FREE_TIER_DEFAULTS } from '../src/core/config';
import { NEWS_CATEGORIES } from '../src/core/nodeBuffer';

/**
 * Static checks on the migrations that run with the ordinary unit tests, so a
 * drift between the SQL and the TypeScript that mirrors it fails CI even
 * without Docker. The behavioural RLS tests are pgTAP (`npm run db:test`).
 */

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/migrations');
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), 'utf8') }));
const allSql = migrations.map((m) => m.sql).join('\n');

/** The last match wins, so a later migration that widens a range is what counts. */
function lastMatch(pattern: RegExp): RegExpMatchArray | undefined {
  return [...allSql.matchAll(pattern)].at(-1);
}

describe('migrations', () => {
  it('are named <timestamp>_name.sql so the Supabase CLI applies them in order', () => {
    expect(migrations.length).toBeGreaterThan(0);
    for (const { name } of migrations) expect(name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it('enable RLS on every table they create (CLAUDE.md #8)', () => {
    const created = [...allSql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    const secured = new Set(
      [...allSql.matchAll(/alter table public\.(\w+) enable row level security/g)].map((m) => m[1]),
    );
    expect(created.length).toBeGreaterThan(0);
    expect(created.filter((table) => !secured.has(table))).toEqual([]);
  });

  it('allow exactly the categories in NEWS_CATEGORIES', () => {
    const match = lastMatch(/stories_category_range check \(category between 0 and (\d+)\)/g);
    expect(Number(match?.[1])).toBe(NEWS_CATEGORIES.length - 1);
  });

  it('cap posts at the same length as the app (CLAUDE.md #7)', () => {
    const match = lastMatch(/posts_body_length check \(char_length\(body\) between 1 and (\d+)\)/g);
    expect(Number(match?.[1])).toBe(FREE_TIER_DEFAULTS.maxPostLength);
  });

  it('store no user coordinates (CLAUDE.md #5)', () => {
    // Stories carry the news event's location; nothing a user writes may.
    const userTables = ['profiles', 'posts', 'votes', 'reports', 'blocks'];
    for (const table of userTables) {
      const body = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(
        allSql,
      )?.[1];
      expect(body, table).toBeDefined();
      expect(body, table).not.toMatch(/\b(lat|lon|latitude|longitude|geog|geom|geography)\b/i);
    }
  });
});
