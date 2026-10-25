/**
 * Captures the payload budget's fixture (Prompt 5.2): one real day of stories,
 * as api_nodes answers for it, saved Brotli-compressed for
 * tests/budgets/payload.test.ts.
 *
 *   npm run api:capture-day -- <stories.json> [--hours 24] [--limit 3000]
 *
 * <stories.json> is `{ stories: [...] }`, rows of public.stories as JSON (a
 * day exported from a GDELT load). In one transaction on the local stack, the
 * script empties stories, inserts the day with its real seq ids (their digits
 * are part of the size), asks api_nodes for the window, and rolls back:
 * nothing local changes.
 *
 * Capture again whenever api_nodes gains or changes a column; pgTAP
 * (05_api) fails until then.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const OUT = 'tests/budgets/nodes-day.json.br';

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(name);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

const source = process.argv[2];
if (source === undefined || source.startsWith('--')) {
  console.error('usage: npm run api:capture-day -- <stories.json> [--hours 24] [--limit 3000]');
  process.exit(1);
}
const hours = Number(arg('--hours', '24'));
const limit = Number(arg('--limit', '3000'));
const { stories } = JSON.parse(readFileSync(source, 'utf8')) as { stories: unknown[] };
const rows = JSON.stringify(stories);
if (rows.includes('$day$')) throw new Error('the stories contain the SQL quote marker $day$');

const sql = `
begin;
delete from public.stories;
insert into public.stories
  (id, title, category, lat, lon, place_name, place_conf, country_code, heat, sentiment,
   source_count, published_at, first_seen_at, title_hash, discussion_state, seq)
overriding system value
select id, title, category, lat, lon, place_name, place_conf, country_code, heat, sentiment,
       source_count, published_at, first_seen_at, title_hash, discussion_state, seq
from jsonb_populate_recordset(null::public.stories, $day$${rows}$day$::jsonb);
select public.api_nodes(${hours}, ${limit})->'payload';
rollback;
`;

// Through a file: the day is about a megabyte, past Windows' command-line limit.
const dir = mkdtempSync(join(tmpdir(), 'agora-capture-'));
let payload: string;
try {
  const file = join(dir, 'capture.sql');
  writeFileSync(file, sql);
  payload = execFileSync('psql', [DB_URL, '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', file], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const parsed = JSON.parse(payload) as { nodes: { id: unknown[] } };
// The fixture is stored at the highest quality; what is measured is the
// Worker's own re-encoding, in the test.
writeFileSync(
  OUT,
  brotliCompressSync(Buffer.from(payload), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }),
);
console.log(`${OUT}: ${parsed.nodes.id.length} nodes of ${stories.length} stories, ${hours} h`);
