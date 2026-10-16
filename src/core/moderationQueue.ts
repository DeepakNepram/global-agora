/**
 * The admins' moderation queue (Prompt 4.3; 4.6 puts it in the console at
 * /admin): posts the toxicity check held, posts readers reported, and posts
 * the models never answered for, with approve / remove / strike. The
 * database refuses anyone who is not an admin (public.moderation_queue()).
 */

import { REPORT_REASONS } from './moderation';

export type QueuedFor = 'hidden' | 'reported' | 'unchecked';
export type ModerationAction = 'approve' | 'remove' | 'strike';

export interface QueueItem {
  readonly postId: string;
  readonly storyId: string;
  readonly prompt: string;
  /** The side the post took, as the debate names it ("Neutral" for neutral). */
  readonly sideLabel: string;
  readonly body: string;
  readonly kind: string;
  readonly evidenceUrl: string | null;
  readonly createdAtMs: number;
  readonly authorId: string;
  readonly authorHandle: string;
  readonly authorStrikes: number;
  readonly authorSuspended: boolean;
  readonly strikesToSuspend: number;
  readonly queuedFor: QueuedFor;
  readonly waitingSinceMs: number;
  readonly reportCount: number;
  /** Open reports by reason, e.g. { harassment: 2 }. */
  readonly reportReasons: Readonly<Record<string, number>>;
  /** Google's Toxic confidence, when the models answered. */
  readonly toxicity: number | null;
  readonly flagged: readonly string[];
}

export interface AdminRemote {
  /** The queue, longest waiting first. Throws not-allowed for a non-admin. */
  queue(limit: number): Promise<QueueItem[]>;
  /** The post's new state. */
  act(postId: string, action: ModerationAction): Promise<'ok' | 'removed'>;
}

/** How many the page loads at once: a working list, not a limit on moderation. */
export const QUEUE_PAGE = 100;

export const QUEUED_FOR_LABEL: Readonly<Record<QueuedFor, string>> = {
  hidden: 'Held by the toxicity check',
  reported: 'Reported',
  unchecked: 'Not checked by the models',
};

export function reportReasonLabel(reason: string): string {
  return REPORT_REASONS.find((known) => known.id === reason)?.label ?? reason;
}

/** "Harassment ×2, Spam": the open reports, most first. */
export function reportSummary(reasons: Readonly<Record<string, number>>): string {
  return Object.entries(reasons)
    .sort(([a, m], [b, n]) => n - m || a.localeCompare(b))
    .map(([reason, count]) => `${reportReasonLabel(reason)}${count > 1 ? ` ×${count}` : ''}`)
    .join(', ');
}

/** What a strike will do, said before it is given. */
export function strikeConsequence(item: QueueItem): string {
  const next = item.authorStrikes + 1;
  if (item.authorSuspended) return `@${item.authorHandle} is already suspended.`;
  if (next >= item.strikesToSuspend) {
    return `This is strike ${next} of ${item.strikesToSuspend}: it suspends @${item.authorHandle}.`;
  }
  return `This is strike ${next} of ${item.strikesToSuspend} for @${item.authorHandle}.`;
}
