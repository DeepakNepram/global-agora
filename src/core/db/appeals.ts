/**
 * Appeals for moderators over Supabase (Prompt 5.2): admin_appeals() and
 * decide_appeal(). A suspended account's own appeal goes through the account
 * remote (account.ts). Errors become AdminErrors.
 */

// Explicit .ts: scripts/db/smoke.ts loads this under plain Node, which needs it.
import { AdminError } from '../admin.ts';
import type { AdminAppeal, AppealsRemote, AppealStatus } from '../appeal.ts';
import { adminErrorCode } from './admin.ts';
import type { DbClient } from './client';

// The generated types cannot know which columns may be null.
interface AppealRow {
  readonly id: string;
  readonly handle: string;
  readonly body: string;
  readonly status: AppealStatus;
  readonly created_at: string;
  readonly decided_at: string | null;
  readonly reply: string | null;
  readonly strikes: number;
  readonly suspended_at: string | null;
  readonly removed_posts: unknown;
}

function removedPosts(value: unknown): AdminAppeal['removedPosts'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((post: unknown) => {
    if (typeof post !== 'object' || post === null) return [];
    const { body, created_at: createdAt } = post as Record<string, unknown>;
    return typeof body === 'string' && typeof createdAt === 'string'
      ? [{ body, createdAtMs: Date.parse(createdAt) }]
      : [];
  });
}

export function toAdminAppeal(row: AppealRow): AdminAppeal {
  return {
    id: row.id,
    handle: row.handle,
    body: row.body,
    status: row.status,
    createdAtMs: Date.parse(row.created_at),
    decidedAtMs: row.decided_at === null ? null : Date.parse(row.decided_at),
    reply: row.reply,
    strikes: row.strikes,
    suspended: row.suspended_at !== null,
    removedPosts: removedPosts(row.removed_posts),
  };
}

function fail(action: string, error: { message: string; code?: string | undefined } | null): void {
  if (!error) return;
  // decide_appeal's 55000 is "already decided", not the story queue's meaning.
  const code = error.code === '55000' ? 'decided' : adminErrorCode(error);
  throw new AdminError(code, `${action}: ${error.message}`);
}

export function createAppealsRemote(client: DbClient): AppealsRemote {
  return {
    async list(limit) {
      const { data, error } = await client.rpc('admin_appeals', { p_limit: limit });
      fail('read the appeals', error);
      return ((data ?? []) as readonly AppealRow[]).map(toAdminAppeal);
    },

    async decide(id, grant, reply) {
      const { data, error } = await client.rpc('decide_appeal', {
        p_appeal: id,
        p_grant: grant,
        p_reply: reply,
      });
      fail('decide the appeal', error);
      return data === 'granted' ? 'granted' : 'refused';
    },
  };
}
