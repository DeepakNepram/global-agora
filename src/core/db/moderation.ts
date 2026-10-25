/**
 * Moderation over Supabase (Prompt 4.3): report_post(), the reader's own
 * blocks and notifications under RLS. Errors become ModerationErrors with a
 * code the UI can explain, never the server's own text.
 */

// Explicit .ts: scripts/db/smoke.ts loads this under plain Node, which needs it.
import {
  ModerationError,
  type AppNotice,
  type BlockedAccount,
  type ModerationErrorCode,
  type ModerationRemote,
} from '../moderation.ts';
import type { DbClient } from './client';

interface ServerError {
  readonly message: string;
  readonly code?: string | undefined;
}

export function moderationErrorCode(error: ServerError): ModerationErrorCode {
  const code = error.code ?? '';
  if (code === '23505') return 'already-reported';
  if (code === 'P0002' || code === '23503') return 'not-found';
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST303') return 'not-allowed';
  if (code === '55000') return 'out-of-order';
  if (/failed to fetch|network/i.test(error.message)) return 'network';
  return 'unknown';
}

export function fail(action: string, error: ServerError | null): void {
  if (error) throw new ModerationError(moderationErrorCode(error), `${action}: ${error.message}`);
}

interface NoticeRow {
  readonly id: string;
  readonly kind: string;
  readonly post_id: string | null;
  readonly story_id: string | null;
  readonly detail: unknown;
  readonly created_at: string;
  readonly read_at: string | null;
  readonly discussions: { readonly prompt: string } | null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A row as a notice; null for a kind this build does not know. */
export function toNotice(row: NoticeRow): AppNotice | null {
  const detail = (
    typeof row.detail === 'object' && row.detail !== null ? row.detail : {}
  ) as Record<string, unknown>;
  const base = {
    id: row.id,
    createdAtMs: Date.parse(row.created_at),
    readAtMs: row.read_at === null ? null : Date.parse(row.read_at),
    postId: row.post_id,
    storyId: row.story_id,
    prompt: row.discussions?.prompt ?? null,
  };
  if (row.kind === 'report_outcome') {
    return {
      ...base,
      kind: 'report_outcome',
      outcome: detail.outcome === 'removed' ? 'removed' : 'kept',
    };
  }
  if (row.kind === 'post_removed') {
    const flagged = Array.isArray(detail.flagged)
      ? detail.flagged.filter((category): category is string => typeof category === 'string')
      : [];
    return {
      ...base,
      kind: 'post_removed',
      source: detail.source === 'moderator' ? 'moderator' : 'auto',
      flagged,
      strike: detail.strike === true,
      strikes: numberOr(detail.strikes, 0),
      strikesToSuspend: numberOr(detail.strikes_to_suspend, 3),
      suspended: detail.suspended === true,
    };
  }
  if (row.kind === 'appeal_outcome') {
    return {
      ...base,
      kind: 'appeal_outcome',
      granted: detail.granted === true,
      reply: typeof detail.reply === 'string' ? detail.reply : '',
    };
  }
  return null;
}

export function createModerationRemote(client: DbClient): ModerationRemote {
  return {
    async reportPost(postId, reason) {
      const { error } = await client.rpc('report_post', { p_post: postId, p_reason: reason });
      fail('report the post', error);
    },

    async block(userId) {
      // The blocker is the caller (the column's default; RLS checks it).
      const { error } = await client.from('blocks').insert({ blocked_id: userId });
      fail('block the account', error);
    },

    async unblock(userId) {
      const { error } = await client.from('blocks').delete().eq('blocked_id', userId);
      fail('unblock the account', error);
    },

    async blockedAccounts() {
      const { data, error } = await client
        .from('blocks')
        .select('blocked_id, created_at, profiles!blocks_blocked_id_fkey(handle)')
        .order('created_at', { ascending: false });
      fail('read your blocks', error);
      return (data ?? []).map((row): BlockedAccount => ({
        userId: row.blocked_id,
        handle: row.profiles?.handle ?? null,
        blockedAtMs: Date.parse(row.created_at),
      }));
    },

    async notices(limit) {
      const { data, error } = await client
        .from('notifications')
        .select('id, kind, post_id, story_id, detail, created_at, read_at, discussions(prompt)')
        .order('created_at', { ascending: false })
        .limit(limit);
      fail('read your updates', error);
      return (data ?? [])
        .map((row) => toNotice(row as NoticeRow))
        .filter((notice): notice is AppNotice => notice !== null);
    },

    async unreadNotices() {
      const { count, error } = await client
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      fail('count your updates', error);
      return count ?? 0;
    },

    async markNoticesRead(nowMs) {
      const { error } = await client
        .from('notifications')
        .update({ read_at: new Date(nowMs).toISOString() })
        .is('read_at', null);
      fail('mark your updates read', error);
    },
  };
}
