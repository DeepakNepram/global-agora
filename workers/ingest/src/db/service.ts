/**
 * The ingest Worker's database access: six RPCs and one read, over PostgREST
 * with the service key. That key bypasses RLS, so it lives only in Worker
 * secrets (CLAUDE.md #9) and this file is the only place that sends it.
 *
 * No supabase-js here: a cron job needs no auth session, realtime or storage
 * client, and a typed fetch keeps each call explicit.
 */

import type { Database, Json } from '../../../../src/core/db/types.ts';
import type { Fetch } from '../gdelt/feed.ts';

type Functions = Database['public']['Functions'];
type Args<F extends keyof Functions> = Functions[F]['Args'];
type Returns<F extends keyof Functions> = Functions[F]['Returns'];

export type CandidateRow = Returns<'ingest_candidates'>[number];

export interface ApplyResult {
  readonly stories_new: number;
  readonly stories_updated: number;
  readonly articles_new: number;
}

export interface PruneResult {
  readonly stories_deleted: number;
  readonly stories_kept_for_discussion: number;
  readonly runs_deleted: number;
  readonly signals_deleted: number;
}

export interface IngestDb {
  /** The newest slot finished (done or skipped), as an ISO timestamp. */
  cursor(): Promise<string | null>;
  claim(slotIso: string): Promise<boolean>;
  finish(
    slotIso: string,
    status: 'failed' | 'skipped',
    counts: Json,
    error?: string,
  ): Promise<string>;
  knownUrls(urls: readonly string[]): Promise<Set<string>>;
  candidates(
    clusters: readonly { i: number; keys: readonly string[] }[],
    sinceIso: string,
  ): Promise<CandidateRow[]>;
  apply(batch: Json): Promise<ApplyResult>;
  prune(
    storyCutoffIso: string,
    runCutoffIso: string,
    signalCutoffIso: string,
  ): Promise<PruneResult>;
}

export class DbError extends Error {
  override readonly name = 'DbError';
}

/**
 * PostgREST returns at most this many rows per call (Supabase's default
 * max_rows) and says nothing when it cuts: the first real run lost candidate
 * matches that way. Calls are chunked to stay under it, and a full page is
 * treated as an error rather than trusted.
 */
export const MAX_ROWS = 1000;
const URLS_PER_CALL = 900;
/** ingest_candidates returns up to three rows per cluster. */
const CLUSTERS_PER_CALL = 300;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function checkPage<T>(name: string, rows: T[]): T[] {
  if (rows.length >= MAX_ROWS) {
    throw new DbError(`${name}: ${rows.length} rows, the PostgREST limit; results may be cut`);
  }
  return rows;
}

/**
 * New-style keys (`sb_secret_…`) go in `apikey` alone; a legacy service-role
 * JWT is also sent as the bearer token, which is how PostgREST picks the role.
 */
function authHeaders(serviceKey: string): Record<string, string> {
  return serviceKey.startsWith('sb_')
    ? { apikey: serviceKey }
    : { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
}

export function createServiceDb(url: string, serviceKey: string, fetchFn: Fetch = fetch): IngestDb {
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  const headers = { ...authHeaders(serviceKey), 'content-type': 'application/json' };

  async function call<F extends keyof Functions>(name: F, args: Args<F>): Promise<Returns<F>> {
    const response = await fetchFn(`${base}/rpc/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });
    const text = await response.text();
    if (!response.ok) throw new DbError(`${name}: HTTP ${response.status} ${text.slice(0, 500)}`);
    return JSON.parse(text) as Returns<F>;
  }

  return {
    async cursor(): Promise<string | null> {
      const response = await fetchFn(
        `${base}/ingest_runs?select=slot&status=in.(done,skipped)&order=slot.desc&limit=1`,
        { headers },
      );
      if (!response.ok) throw new DbError(`cursor: HTTP ${response.status}`);
      const rows = (await response.json()) as { slot: string }[];
      return rows[0]?.slot ?? null;
    },

    claim: (slotIso) => call('ingest_claim', { p_slot: slotIso }),

    finish: (slotIso, status, counts, error) =>
      call('ingest_finish', {
        p_slot: slotIso,
        p_status: status,
        p_counts: counts,
        ...(error === undefined ? {} : { p_error: error }),
      }),

    async knownUrls(urls): Promise<Set<string>> {
      const known = new Set<string>();
      for (const chunk of chunks(urls, URLS_PER_CALL)) {
        const rows = await call('ingest_known_urls', { p_urls: chunk });
        for (const url of checkPage('ingest_known_urls', rows)) known.add(url);
      }
      return known;
    },

    async candidates(clusters, sinceIso): Promise<CandidateRow[]> {
      const rows: CandidateRow[] = [];
      for (const chunk of chunks(clusters, CLUSTERS_PER_CALL)) {
        const page = await call('ingest_candidates', {
          p_clusters: chunk.map((c) => ({ i: c.i, keys: [...c.keys] })),
          p_since: sinceIso,
        });
        rows.push(...checkPage('ingest_candidates', page));
      }
      return rows;
    },

    async apply(batch): Promise<ApplyResult> {
      return (await call('ingest_apply', { p_batch: batch })) as unknown as ApplyResult;
    },

    async prune(storyCutoffIso, runCutoffIso, signalCutoffIso): Promise<PruneResult> {
      return (await call('ingest_prune', {
        p_story_cutoff: storyCutoffIso,
        p_run_cutoff: runCutoffIso,
        p_signal_cutoff: signalCutoffIso,
      })) as unknown as PruneResult;
    },
  };
}
