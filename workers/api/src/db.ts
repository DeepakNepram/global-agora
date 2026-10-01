/**
 * The API Worker's database access: RPCs over PostgREST with the publishable
 * (anon) key. They run as the anon role, so this Worker holds no key that can
 * read or write anything a signed-out visitor cannot: reads under RLS, and the
 * location report, which can only add one to a counter.
 *
 * No supabase-js here, as in the ingest Worker: three calls need no auth
 * session, realtime or storage client.
 */

import type { Database } from '../../../src/core/db/types.ts';
import { restBase, supabaseAuthHeaders } from '../../shared/supabase.ts';

type Functions = Database['public']['Functions'];
type Args<F extends keyof Functions> = Functions[F]['Args'];

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What api_nodes and api_outlets return: the body, or only the hash when `known` matched. */
export interface NodesResult {
  readonly hash: string;
  readonly payload?: unknown;
}

export type StoryRef = { readonly seq: number } | { readonly id: string };

export interface ApiDb {
  nodes(hours: number, limit: number, known: string | null): Promise<NodesResult>;
  /** The story as api_story builds it, or null when there is none. */
  story(ref: StoryRef, articleLimit: number): Promise<unknown>;
  /** One "wrong location" report; false when there is no such story. */
  reportLocation(ref: StoryRef): Promise<boolean>;
  /** The outlets covering the window's stories, with the same hash protocol as nodes. */
  outlets(hours: number, limit: number, known: string | null): Promise<NodesResult>;
  /** One outlet's window stories, as api_outlet_stories builds them. */
  outletStories(outlet: string, hours: number, limit: number): Promise<unknown>;
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

  /** The hash protocol's reply: the hash, and the body unless the caller had it. */
  function hashed(name: string, result: unknown): NodesResult {
    if (typeof result !== 'object' || result === null || !('hash' in result)) {
      throw new DbError(`${name}: no hash in the response`);
    }
    const { hash, payload } = result as { hash: unknown; payload?: unknown };
    if (typeof hash !== 'string') throw new DbError(`${name}: hash is not text`);
    return payload === undefined || payload === null ? { hash } : { hash, payload };
  }

  return {
    async nodes(hours, limit, known): Promise<NodesResult> {
      const args = {
        p_hours: hours,
        p_limit: limit,
        ...(known === null ? {} : { p_known: known }),
      };
      return hashed('api_nodes', await call('api_nodes', args));
    },

    async outlets(hours, limit, known): Promise<NodesResult> {
      const args = {
        p_hours: hours,
        p_limit: limit,
        ...(known === null ? {} : { p_known: known }),
      };
      return hashed('api_outlets', await call('api_outlets', args));
    },

    outletStories: (outlet, hours, limit) =>
      call('api_outlet_stories', { p_outlet: outlet, p_hours: hours, p_limit: limit }),

    story: (ref, articleLimit) =>
      call('api_story', {
        ...('seq' in ref ? { p_seq: ref.seq } : { p_id: ref.id }),
        p_article_limit: articleLimit,
      }),

    async reportLocation(ref): Promise<boolean> {
      const result = await call(
        'api_report_location',
        'seq' in ref ? { p_seq: ref.seq } : { p_id: ref.id },
      );
      if (typeof result !== 'boolean') throw new DbError('api_report_location: not a boolean');
      return result;
    },
  };
}
