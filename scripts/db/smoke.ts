/**
 * Queries the database back through the typed anon client, exactly as the app
 * will: the stories and articles must come back, and every other table must
 * refuse. Exits non-zero on any surprise.
 *
 *   npm run db:smoke                         local stack (reads `supabase status`)
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… npm run db:smoke    any project, anon key only
 */
import { execSync } from 'node:child_process';

import { FREE_TIER_DEFAULTS } from '../../src/core/config.ts';
import { createDbClient, type DbConfig } from '../../src/core/db/client.ts';
import type { Database } from '../../src/core/db/types.ts';

type TableName = keyof Database['public']['Tables'];

/** Postgres "insufficient_privilege": the grant is missing, so RLS is never even reached. */
const DENIED = '42501';

function localConfig(): DbConfig {
  const url = process.env['SUPABASE_URL'];
  const anonKey = process.env['SUPABASE_ANON_KEY'];
  if (url !== undefined && anonKey !== undefined) return { url, anonKey };

  const output = execSync('npx supabase status -o json', { encoding: 'utf8' });
  const json = output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1);
  const status = JSON.parse(json) as { API_URL?: string; ANON_KEY?: string };
  if (status.API_URL === undefined || status.ANON_KEY === undefined) {
    // `supabase db start` (what CI runs) brings up Postgres without the API,
    // and a later `supabase start` then reports "already running".
    throw new Error(
      'The local Supabase API is not running. Run `npm run db:stop`, then `npm run db:start`.',
    );
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY };
}

const results: { check: string; ok: boolean; detail: string }[] = [];
function record(check: string, ok: boolean, detail: string): void {
  results.push({ check, ok, detail });
}

const config = localConfig();
const db = createDbClient(config, { persistSession: false });
const windowHours = FREE_TIER_DEFAULTS.historyWindowHours;
const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

// --- Signed out, news is readable. -----------------------------------------
const inWindow = await db
  .from('stories')
  .select('id', { count: 'exact', head: true })
  .gte('published_at', since);
record(
  `anon counts stories from the last ${windowHours} h`,
  inWindow.error === null && (inWindow.count ?? 0) > 0,
  inWindow.error?.message ?? `${inWindow.count} stories`,
);

const newest = await db
  .from('stories')
  .select('title, place_name, published_at, heat, articles(outlet, headline)')
  .order('published_at', { ascending: false })
  .limit(5);
record(
  'anon reads the newest stories with their articles',
  newest.error === null && (newest.data?.length ?? 0) > 0,
  newest.error?.message ?? `${newest.data?.length} rows`,
);

const articleCount = await db.from('articles').select('id', { count: 'exact', head: true });
record(
  'anon counts articles',
  articleCount.error === null && (articleCount.count ?? 0) > 0,
  articleCount.error?.message ?? `${articleCount.count} articles`,
);

// --- Signed out, everything else is refused. --------------------------------
const closed: readonly TableName[] = [
  'profiles',
  'feature_flags',
  'discussions',
  'posts',
  'votes',
  'reports',
  'blocks',
  'story_signals',
  'ingest_runs',
];
for (const table of closed) {
  const { error } = await db.from(table).select('*').limit(1);
  record(`anon is refused ${table}`, error?.code === DENIED, error?.message ?? 'READABLE');
}

const insert = await db
  .from('stories')
  .insert({ title: 'smoke', category: 0, lat: 0, lon: 0, published_at: new Date().toISOString() });
record(
  'anon cannot insert a story',
  insert.error?.code === DENIED,
  insert.error?.message ?? 'INSERTED',
);

const update = await db.from('stories').update({ heat: 255 }).gte('heat', 0);
record(
  'anon cannot update stories',
  update.error?.code === DENIED,
  update.error?.message ?? 'UPDATED',
);

const remove = await db.from('articles').delete().gte('published_at', since);
record(
  'anon cannot delete articles',
  remove.error?.code === DENIED,
  remove.error?.message ?? 'DELETED',
);

// The ingest Worker's write functions are service-only (Prompt 2.2).
const prune = await db.rpc('ingest_prune', { p_story_cutoff: since, p_run_cutoff: since });
record(
  'anon cannot call the ingest functions',
  prune.error?.code === DENIED,
  prune.error?.message ?? 'CALLED',
);

// The API Worker's two reads are the only functions a client may call (2.3).
const nodes = await db.rpc('api_nodes', { p_hours: windowHours, p_limit: 3000 });
const nodeIds = (nodes.data as { payload?: { nodes?: { id?: number[] } } } | null)?.payload?.nodes
  ?.id;
record(
  'anon calls api_nodes',
  nodes.error === null && (nodeIds?.length ?? 0) > 0,
  nodes.error?.message ?? `${nodeIds?.length ?? 0} nodes`,
);

const story = await db.rpc('api_story', { p_seq: nodeIds?.[0] ?? -1 });
const storyTitle = (story.data as { title?: string } | null)?.title;
record(
  'anon calls api_story for a payload id',
  story.error === null && storyTitle !== undefined,
  story.error?.message ?? storyTitle ?? 'NOT FOUND',
);

// --- Report. ------------------------------------------------------------------
console.log(`\nSupabase at ${config.url}\n`);
console.log('Newest stories:');
for (const story of newest.data ?? []) {
  const outlets = story.articles.map((article) => article.outlet).join(', ');
  const sources = `${story.articles.length} source${story.articles.length === 1 ? '' : 's'}`;
  console.log(`  ${story.published_at}  heat ${String(story.heat).padStart(3)}  ${story.title}`);
  console.log(`      ${story.place_name}; ${sources}: ${outlets}`);
}
console.log('');
for (const { check, ok, detail } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check.padEnd(48)} ${detail}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
