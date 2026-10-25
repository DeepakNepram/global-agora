/**
 * Moderation as the app sees it (Prompt 4.3): reporting and blocking, the
 * in-app notices that tell a reporter the outcome and an author about a
 * removal, and the admins' queue. ModerationRemote is implemented over the
 * SDK in db/moderation.ts, so src/state never sees the SDK.
 *
 * The decisions themselves happen in the database
 * (supabase/migrations/20261017100000_moderation.sql and after).
 */

/** The six reasons, in the order the report sheet lists them. */
export const REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment' },
  { id: 'hate', label: 'Hate' },
  { id: 'threat', label: 'Threat' },
  { id: 'spam', label: 'Spam' },
  { id: 'false_expertise', label: 'False expertise claim' },
  { id: 'off_topic', label: 'Off-topic' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

interface NoticeBase {
  readonly id: string;
  readonly createdAtMs: number;
  readonly readAtMs: number | null;
  readonly postId: string | null;
  readonly storyId: string | null;
  /** The debate's question, or null when the discussion has gone. */
  readonly prompt: string | null;
}

/** The outcome of a report you made. Nothing about the author. */
export interface ReportOutcomeNotice extends NoticeBase {
  readonly kind: 'report_outcome';
  readonly outcome: 'kept' | 'removed';
}

/** Your post was removed: by the automatic check or a moderator. */
export interface PostRemovedNotice extends NoticeBase {
  readonly kind: 'post_removed';
  readonly source: 'auto' | 'moderator';
  /** OpenAI's categories, for an automatic removal; empty otherwise. */
  readonly flagged: readonly string[];
  readonly strike: boolean;
  /** The account's strikes after this one, and how many suspend. */
  readonly strikes: number;
  readonly strikesToSuspend: number;
  readonly suspended: boolean;
}

/** A moderator decided your appeal (Prompt 5.2), with their reply. */
export interface AppealOutcomeNotice extends NoticeBase {
  readonly kind: 'appeal_outcome';
  readonly granted: boolean;
  readonly reply: string;
}

export type AppNotice = ReportOutcomeNotice | PostRemovedNotice | AppealOutcomeNotice;

export interface NoticeText {
  readonly title: string;
  readonly body: string;
  /** Somewhere to turn: shown for a post about self-harm. */
  readonly help?: { readonly label: string; readonly href: string };
}

export const HELP_LINK = { label: 'Find a helpline', href: 'https://findahelpline.com' } as const;

/** OpenAI's categories in plain words, for the author's notice. */
const CATEGORY_WORDS: Readonly<Record<string, string>> = {
  harassment: 'harassment',
  'harassment/threatening': 'threats',
  hate: 'hate',
  'hate/threatening': 'threats',
  violence: 'violence',
  'violence/graphic': 'graphic violence',
  sexual: 'sexual content',
  'sexual/minors': 'sexual content',
  illicit: 'illegal activity',
  'illicit/violent': 'illegal activity',
  'self-harm': 'self-harm',
  'self-harm/intent': 'self-harm',
  'self-harm/instructions': 'self-harm',
};

function where(prompt: string | null): string {
  return prompt === null ? 'a discussion' : `“${prompt}”`;
}

function standing(notice: PostRemovedNotice): string {
  if (!notice.strike) return 'There is no strike for this.';
  const count = `This is strike ${notice.strikes} of ${notice.strikesToSuspend}.`;
  if (notice.suspended) return `${count} Your account can no longer post, vote or take sides.`;
  if (notice.strikes === notice.strikesToSuspend - 1) {
    return `${count} One more suspends posting and voting.`;
  }
  return count;
}

export function describeNotice(notice: AppNotice): NoticeText {
  if (notice.kind === 'appeal_outcome') {
    return notice.granted
      ? {
          title: 'Appeal granted',
          body:
            'A moderator granted your appeal. Your account can post, vote and take sides again, ' +
            `and the strikes behind the suspension no longer count. They wrote: “${notice.reply}”`,
        }
      : {
          title: 'Appeal refused',
          body:
            'A moderator looked at your appeal, and the suspension stays. They wrote: ' +
            `“${notice.reply}” Your account says when you can appeal again.`,
        };
  }
  if (notice.kind === 'report_outcome') {
    return notice.outcome === 'removed'
      ? {
          title: 'Post removed',
          body: `Thanks for your report. We removed the post in ${where(notice.prompt)}.`,
        }
      : {
          title: 'Report reviewed',
          body:
            `We reviewed the post you reported in ${where(notice.prompt)}. ` +
            'It does not break the community rules, so it stays up.',
        };
  }

  const selfHarm =
    notice.flagged.length > 0 &&
    notice.flagged.every((category) => category.startsWith('self-harm'));
  if (selfHarm && !notice.strike) {
    return {
      title: 'Your post was removed',
      body:
        `Your post in ${where(notice.prompt)} talked about self-harm, so it is not public. ` +
        'There is no strike for this. If you are going through something hard, you do not ' +
        'have to face it alone: free, confidential support is available.',
      help: HELP_LINK,
    };
  }

  const words = [...new Set(notice.flagged.map((category) => CATEGORY_WORDS[category]))].filter(
    (word): word is string => word !== undefined,
  );
  const why =
    notice.source === 'moderator'
      ? 'A moderator removed it for breaking the community rules.'
      : words.length > 0
        ? `Our automatic check found it breaks the community rules (${words.join(', ')}).`
        : 'Our automatic check found it breaks the community rules.';
  return {
    title: 'Your post was removed',
    body: `Your post in ${where(notice.prompt)} is not public. ${why} ${standing(notice)}`,
    ...(notice.flagged.some((category) => category.startsWith('self-harm'))
      ? { help: HELP_LINK }
      : {}),
  };
}

/**
 * The posting limits' wait (SQLSTATE PT429, HTTP 429), in seconds, from the
 * error's detail; null for any other error.
 */
export function rateLimitWait(error: {
  readonly code?: string | undefined;
  readonly details?: string | null | undefined;
}): number | null {
  if (error.code !== 'PT429') return null;
  try {
    const seconds = (JSON.parse(error.details ?? '') as { retry_after_seconds?: unknown })
      .retry_after_seconds;
    return typeof seconds === 'number' && seconds > 0 ? Math.ceil(seconds) : 60;
  } catch {
    return 60;
  }
}

export interface BlockedAccount {
  readonly userId: string;
  readonly handle: string | null;
  readonly blockedAtMs: number;
}

export type ModerationErrorCode =
  /** You reported this post already. */
  | 'already-reported'
  /** The post is gone, or you cannot see it (blocked, not approved, your own). */
  | 'not-found'
  /** Signed out, or not allowed (not an admin). */
  | 'not-allowed'
  /** Decided already (a removed post). */
  | 'out-of-order'
  | 'network'
  | 'unknown';

export class ModerationError extends Error {
  override readonly name: string = 'ModerationError';
  readonly code: ModerationErrorCode;
  constructor(code: ModerationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ModerationRemote {
  /** Reports a post you can see, once. Throws already-reported on a second. */
  reportPost(postId: string, reason: ReportReason): Promise<void>;
  /** Hides that account's posts from you, and yours from them. */
  block(userId: string): Promise<void>;
  unblock(userId: string): Promise<void>;
  blockedAccounts(): Promise<BlockedAccount[]>;
  /** Your notices, newest first. */
  notices(limit: number): Promise<AppNotice[]>;
  unreadNotices(): Promise<number>;
  /** Marks every unread notice read as of `nowMs` (the caller's clock). */
  markNoticesRead(nowMs: number): Promise<void>;
}
