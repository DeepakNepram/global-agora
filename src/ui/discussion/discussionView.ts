import {
  POST_MAX_CHARS,
  postLength,
  type DiscussionInfo,
  type EvidenceUrlProblem,
  type RoomShares,
  type VoteKind,
} from '@/core/discussion';
import type { PostingErrorCode, PostKind, PostStance } from '@/core/posting';
import type { SendResult, VoteResult } from '@/state/discussionRoomActions';

/**
 * The discussion panel's words (Prompt 4.5), as plain functions so the copy
 * is tested once and reads the same everywhere.
 */

export const KIND_OPTIONS: readonly { readonly kind: PostKind; readonly label: string }[] = [
  { kind: 'argument', label: 'Argument' },
  { kind: 'eyewitness', label: 'Eyewitness' },
  { kind: 'evidence', label: 'Evidence' },
  { kind: 'expert', label: 'Expert' },
];

/** "Expert" always carries the warning that nobody checked (Prompt 4.2). */
export const EXPERT_LABEL = 'self-declared, unverified';

export function kindChip(kind: PostKind): string {
  const label = KIND_OPTIONS.find((option) => option.kind === kind)?.label ?? 'Argument';
  return kind === 'expert' ? `${label} · ${EXPERT_LABEL}` : label;
}

export function sideName(stance: PostStance, info: DiscussionInfo): string {
  if (stance === 'a') return info.sideA;
  if (stance === 'b') return info.sideB;
  return 'Neutral';
}

export interface CounterView {
  readonly count: number;
  /** "320/500". */
  readonly text: string;
  readonly over: boolean;
  /** Close to the limit, so the counter stands out. */
  readonly near: boolean;
}

/** Counts as the database does (code points), so emoji never pass one and fail the other. */
export function counterView(body: string): CounterView {
  const count = postLength(body);
  return {
    count,
    text: `${count}/${POST_MAX_CHARS}`,
    over: count > POST_MAX_CHARS,
    near: count > POST_MAX_CHARS - 50,
  };
}

/**
 * What the counter's live region says as the count crosses 50 left, 10 left
 * and the limit, and nothing in between, so typing is not narrated.
 */
export function counterAnnouncement(previous: number, count: number): string | null {
  const left = POST_MAX_CHARS - count;
  const before = POST_MAX_CHARS - previous;
  if (left < 0 && before >= 0) return `Over the ${POST_MAX_CHARS} character limit.`;
  if (left <= 10 && before > 10 && left >= 0) return `${left} characters left.`;
  if (left <= 50 && before > 50 && left >= 0) return `${left} characters left.`;
  return null;
}

export function evidenceProblemText(problem: EvidenceUrlProblem): string {
  if (problem === 'missing') return 'Evidence needs a link to it.';
  if (problem === 'too-long') return 'That link is too long.';
  return 'Use a full link starting with http:// or https://.';
}

/** "0:42" for a wait in seconds. */
export function waitText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const SEND_FAILURES: Readonly<Record<PostingErrorCode | 'no-side', string>> = {
  'signed-out': 'Sign in to post.',
  'no-side': 'Pick a side first.',
  'rate-limited': 'You are posting too fast.',
  'not-allowed':
    'This post could not go in: the discussion may have closed, or your account cannot post.',
  invalid: 'Check your post: it breaks a rule for posts (length, or the evidence link).',
  unavailable: 'Posting is unavailable right now. Try again in a moment.',
  network: 'Your post was not sent: the connection failed. Try again.',
  unknown: 'Your post was not sent. Try again.',
};

export function sendResultText(result: SendResult): string {
  if (result.ok) {
    return result.badgeDropped
      ? 'Posted without an area: your network no longer gives a city. It shows once it has been checked.'
      : 'Posted. It shows to others once it has been checked.';
  }
  return SEND_FAILURES[result.code];
}

export function voteResultText(result: VoteResult, kind: VoteKind): string | null {
  if (result === 'ok')
    return kind === 'helpful' ? 'Marked helpful.' : 'Marked as changing your mind.';
  if (result === 'no-side')
    return 'Pick a side first: it decides whether your vote counts across sides.';
  if (result === 'own') return 'You cannot vote on your own post.';
  if (result === 'already') return null;
  if (result === 'refused')
    return 'That vote could not be counted: the discussion may have closed.';
  if (result === 'signed-out') return null;
  return 'That vote could not be sent. Try again.';
}

export function voteLabel(kind: VoteKind, count: number): string {
  return `${kind === 'helpful' ? 'Helpful' : 'Changed my mind'}, ${count.toLocaleString('en-US')}`;
}

/** The balance in words: shares are never told by colour alone. */
export function sharesText(shares: RoomShares, info: DiscussionInfo): string {
  if (shares.total === 0) return 'No posts yet.';
  const posts = `${shares.total.toLocaleString('en-US')} ${shares.total === 1 ? 'post' : 'posts'}`;
  return `${info.sideA} ${shares.a}%, Neutral ${shares.neutral}%, ${info.sideB} ${shares.b}%, of ${posts}.`;
}

/** The host a link goes to, shown instead of the whole address. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** "Closes in 31 h" / "Closed": the discussion's clock, in hours. */
export function closingText(info: DiscussionInfo, nowMs: number): string {
  if (info.state === 'closed' || info.closesAtMs <= nowMs) return 'This discussion has closed.';
  const hours = Math.ceil((info.closesAtMs - nowMs) / 3_600_000);
  return hours <= 1 ? 'Closes within the hour.' : `Closes in ${hours} h.`;
}
