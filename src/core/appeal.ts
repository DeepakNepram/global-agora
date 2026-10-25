/**
 * Appeals (Prompt 5.2): a suspended account asks a person to look again
 * (supabase/migrations/20261025100000_appeals.sql). The limits match the
 * database's checks.
 */

/** The longest appeal (appeals.body's check). */
export const APPEAL_MAX_LENGTH = 1000;
/** The longest reply a moderator writes (appeals.reply's check). */
export const APPEAL_REPLY_MAX_LENGTH = 500;

export type AppealStatus = 'pending' | 'granted' | 'refused';

/** The account's latest appeal, as my_profile() gives it. */
export interface AppealSummary {
  readonly status: AppealStatus;
  readonly sentAtMs: number;
  /** The moderator's reply, once decided. */
  readonly reply: string | null;
  /** After a refusal: when the account may appeal again. */
  readonly againAtMs: number | null;
}

/** What the account sheet offers a suspended account. */
export type AppealStanding =
  /** Not suspended: nothing to appeal. */
  | { readonly kind: 'none' }
  | { readonly kind: 'can-appeal'; readonly refusedReply: string | null }
  | { readonly kind: 'pending'; readonly sentAtMs: number }
  | { readonly kind: 'wait'; readonly reply: string | null; readonly againAtMs: number };

export function appealStanding(
  suspendedAtMs: number | null,
  appeal: AppealSummary | null,
  nowMs: number,
): AppealStanding {
  if (suspendedAtMs === null) return { kind: 'none' };
  if (appeal?.status === 'pending') return { kind: 'pending', sentAtMs: appeal.sentAtMs };
  if (appeal?.status === 'refused' && appeal.againAtMs !== null && appeal.againAtMs > nowMs) {
    return { kind: 'wait', reply: appeal.reply, againAtMs: appeal.againAtMs };
  }
  // A grant before a new suspension says nothing about this one.
  return { kind: 'can-appeal', refusedReply: appeal?.status === 'refused' ? appeal.reply : null };
}

/** One appeal in the moderators' list (admin_appeals()). */
export interface AdminAppeal {
  readonly id: string;
  readonly handle: string;
  readonly body: string;
  readonly status: AppealStatus;
  readonly createdAtMs: number;
  readonly decidedAtMs: number | null;
  readonly reply: string | null;
  readonly strikes: number;
  readonly suspended: boolean;
  /** The text of the posts behind the account's standing strikes, newest first. */
  readonly removedPosts: readonly { readonly body: string; readonly createdAtMs: number }[];
}

/** The moderators' side (admin_appeals, decide_appeal); errors are AdminErrors. */
export interface AppealsRemote {
  /** Waiting appeals first, oldest first; then the latest decided. */
  list(limit: number): Promise<AdminAppeal[]>;
  /** Grants or refuses, with the reply the account reads. */
  decide(id: string, grant: boolean, reply: string): Promise<AppealStatus>;
}
