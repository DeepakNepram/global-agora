/**
 * Discussions as the app sees them (Prompt 4.5): the debate, its posts in
 * rank order, the room's balance, and the reader's side and votes.
 * DiscussionRemote is implemented over the SDK in db/discussion.ts, so
 * src/state never sees the SDK; the rules themselves live in the database
 * (supabase/migrations/20261016110000_discussions_access.sql and after).
 */

// Explicit .ts: scripts/db/smoke.ts loads this under plain Node, which needs it.
import { safeHttpUrl } from './data/story.ts';
import type { PostKind, PostModState, PostStance } from './posting.ts';

/** CLAUDE.md #7, posts_body_length in the database (tests/posting-sql.test.ts). */
export const POST_MAX_CHARS = 500;

/** posts.evidence_url's CHECK. */
export const EVIDENCE_URL_MAX_CHARS = 2048;

export interface DiscussionInfo {
  /** The story's uuid: a discussion is keyed by its story. */
  readonly storyId: string;
  /** The debate's question. */
  readonly prompt: string;
  readonly sideA: string;
  readonly sideB: string;
  readonly state: 'open' | 'closed';
  readonly closesAtMs: number;
  /** Approved posts. */
  readonly postCount: number;
}

export interface DiscussionPost {
  readonly id: string;
  readonly authorId: string;
  /** Null only if the profile could not be read. */
  readonly authorHandle: string | null;
  readonly body: string;
  readonly stance: PostStance;
  readonly kind: PostKind;
  readonly evidenceUrl: string | null;
  readonly regionLabel: string | null;
  /** Anything but 'ok' is the reader's own post: nobody else can see those. */
  readonly modState: PostModState;
  readonly helpfulCount: number;
  readonly crossSideCount: number;
  readonly changedMindCount: number;
  readonly rankScore: number;
  readonly createdAtMs: number;
}

export type VoteKind = 'helpful' | 'changed_mind';

export interface MyVote {
  readonly postId: string;
  readonly kind: VoteKind;
}

/** The reader's side in one discussion. */
export interface StanceRecord {
  readonly stance: PostStance;
  /** Fixed by the reader's first post or vote. */
  readonly locked: boolean;
}

/** Approved posts per side, as the reader can see them. */
export interface RoomBalance {
  readonly a: number;
  readonly b: number;
  readonly neutral: number;
}

export interface RoomShares {
  /** Whole percentages that add up to 100, or all 0 for an empty room. */
  readonly a: number;
  readonly b: number;
  readonly neutral: number;
  readonly total: number;
}

/** What a discussion's live feed says. Only ids: the post itself is read under RLS. */
export interface DiscussionFeed {
  /** A post became visible. */
  onPost(id: string): void;
  /** A visible post was removed or deleted. */
  onGone(id: string): void;
  /** The connection came back: something may have been missed. */
  onReconnect(): void;
}

export type DiscussionErrorCode =
  /** Taking part needs an account. */
  | 'signed-out'
  /** Refused by the rules: no side, not agreed to the rules, suspended, closed, or locked. */
  | 'not-allowed'
  /** You did that already (a second vote of the same kind). */
  | 'already-done'
  | 'network'
  | 'unknown';

export class DiscussionError extends Error {
  override readonly name: string = 'DiscussionError';
  // A plain field, not a parameter property: Node's type stripping (db:smoke)
  // cannot compile those.
  readonly code: DiscussionErrorCode;
  constructor(code: DiscussionErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface DiscussionRemote {
  /** The signed-in reader's account id, or null for a guest. */
  readerId(): Promise<string | null>;
  /** The discussion on a story, or null if it has none. */
  discussion(storyId: string): Promise<DiscussionInfo | null>;
  /** Posts the reader can see, best first: rank_score, then newest. */
  posts(storyId: string, offset: number, limit: number): Promise<DiscussionPost[]>;
  /** The reader's own posts here still being checked or held for review, newest first. */
  myUnapproved(storyId: string): Promise<DiscussionPost[]>;
  /** One post, or null when the reader cannot see it (blocked, removed, gone). */
  post(id: string): Promise<DiscussionPost | null>;
  /** The approved posts with the most helpful votes from the other side, at least one. */
  topCrossSide(storyId: string, limit: number): Promise<DiscussionPost[]>;
  balance(storyId: string): Promise<RoomBalance>;
  /** The reader's side, or null when they have none (or are signed out). */
  myStance(storyId: string): Promise<StanceRecord | null>;
  /** Takes a side, or changes it while it is not locked. */
  takeSide(storyId: string, stance: PostStance, change: boolean): Promise<void>;
  /** The reader's votes on these posts; none when signed out. */
  myVotes(postIds: readonly string[]): Promise<MyVote[]>;
  vote(postId: string, kind: VoteKind): Promise<void>;
  /** Listens to a discussion's live feed; returns the way to stop. */
  subscribe(storyId: string, feed: DiscussionFeed): () => void;
}

/**
 * Characters as the database counts them: char_length counts code points, so
 * an emoji is one, not the two UTF-16 units String.length would say.
 */
export function postLength(body: string): number {
  return Array.from(body).length;
}

export type EvidenceUrlProblem = 'missing' | 'not-a-link' | 'too-long';

/** What is wrong with an evidence link, or null when it will pass the CHECK. */
export function evidenceUrlProblem(raw: string): EvidenceUrlProblem | null {
  const url = raw.trim();
  if (url === '') return 'missing';
  if (url.length > EVIDENCE_URL_MAX_CHARS) return 'too-long';
  // The CHECK wants ^https?://, so the link is sent as typed, never normalised.
  return /^https?:\/\//i.test(url) && safeHttpUrl(url) !== null ? null : 'not-a-link';
}

/** Best first: rank, then newest, then id so the order never wobbles. */
export function byRank(a: DiscussionPost, b: DiscussionPost): number {
  return (
    b.rankScore - a.rankScore ||
    b.createdAtMs - a.createdAtMs ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * The list with `post` in its rank place, replacing any copy by id. Returns
 * where it went. The rest of the list keeps its order even if votes have
 * moved ranks since it loaded: posts never jump under the reader.
 */
export function insertByRank(
  list: readonly DiscussionPost[],
  post: DiscussionPost,
): { readonly list: DiscussionPost[]; readonly index: number } {
  const without = list.filter((item) => item.id !== post.id);
  let index = without.findIndex((item) => byRank(post, item) < 0);
  if (index === -1) index = without.length;
  return { list: [...without.slice(0, index), post, ...without.slice(index)], index };
}

/** Appends a page, skipping posts already shown (ranks move between pages). */
export function appendPage(
  list: readonly DiscussionPost[],
  page: readonly DiscussionPost[],
): DiscussionPost[] {
  const seen = new Set(list.map((post) => post.id));
  return [...list, ...page.filter((post) => !seen.has(post.id))];
}

/**
 * Each side's share as whole percentages that add up to exactly 100: floor
 * each, then hand the points left over to the largest remainders.
 */
export function roomShares(balance: RoomBalance): RoomShares {
  const total = balance.a + balance.b + balance.neutral;
  if (total <= 0) return { a: 0, b: 0, neutral: 0, total: 0 };
  const sides = (['a', 'b', 'neutral'] as const).map((side) => {
    const exact = (balance[side] / total) * 100;
    return { side, share: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = 100 - sides.reduce((sum, side) => sum + side.share, 0);
  for (const side of [...sides].sort((x, y) => y.remainder - x.remainder)) {
    if (left <= 0) break;
    side.share += 1;
    left -= 1;
  }
  const share = (name: 'a' | 'b' | 'neutral'): number =>
    sides.find((side) => side.side === name)?.share ?? 0;
  return { a: share('a'), b: share('b'), neutral: share('neutral'), total };
}

/** The live feed's topic for a discussion (private.posts_broadcast). */
export function discussionTopic(storyId: string): string {
  return `discussion:${storyId}`;
}
