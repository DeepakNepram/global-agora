/**
 * The API Worker's database access: two read-only RPCs over PostgREST with the
 * publishable (anon) key. They run as the anon role under RLS, so this Worker
 * holds no key that can read or write anything a signed-out visitor cannot.
 *
 * No supabase-js here, as in the ingest Worker: two calls need no auth session,
 * realtime or storage client.
 */

import type { Database } from '../../../src/core/db/types.ts';
import { restBase, supabaseAuthHeaders } from '../../shared/supabase.ts';

type Functions = Database['public']['Functions'];
type Args<F extends keyof Functions> = Functions[F]['Args'];

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What api_nodes returns: the payload, or only the hash when `known` matched. */
export interface NodesResult {
  readonly hash: string;
  readonly payload?: unknown;
}

export type StoryRef = { readonly seq: number } | { readonly id: string };

export interface ApiDb {
  nodes(hours: number, limit: number, known: string | null): Promise<NodesResult>;
  /** The story as api_story builds it, or null when there is none. */
  story(ref: StoryRef, articleLimit: number): Promise<unknown>;
}

export class DbError extends Error {
  override readonly name = 'DbError';
}

export function createAnonDb(url: string, anonKey: string, fetchFn: Fetch = fetch): ApiDb {
  const base = restBase(url);
  const headers = { ...supabaseAuthHeaders(anonKey), 'content-type': 'application/json' };

  async function call<F extends keyof Functions>(name: F, args: Args<F>): Promise<unknown> {
    const response = await fetchFn(`${base}/rpc/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });
    const text = await response.text();
    if (!response.ok) throw new DbError(`${name}: HTTP ${response.status} ${text.slice(0, 500)}`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new DbError(`${name}: response is not JSON`);
    }
  }

  return {
    async nodes(hours, limit, known): Promise<NodesResult> {
      const result = await call('api_nodes', {
        p_hours: hours,
        p_limit: limit,
        ...(known === null ? {} : { p_known: known }),
      });
      if (typeof result !== 'object' || result === null || !('hash' in result)) {
        throw new DbError('api_nodes: no hash in the response');
      }
      const { hash, payload } = result as { hash: unknown; payload?: unknown };
      if (typeof hash !== 'string') throw new DbError('api_nodes: hash is not text');
      return payload === undefined || payload === null ? { hash } : { hash, payload };
    },

    story: (ref, articleLimit) =>
      call('api_story', {
        ...('seq' in ref ? { p_seq: ref.seq } : { p_id: ref.id }),
        p_article_limit: articleLimit,
      }),
  };
}
