import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type {
  DiscussionInfo,
  DiscussionPost,
  RoomBalance,
  StanceRecord,
  VoteKind,
} from '@/core/discussion';

/**
 * The open discussion as the panel shows it (Prompt 4.5): the debate, its
 * posts best first, the room's balance, and the reader's side, votes and
 * own posts. Plain data; discussionRoomController.ts fills it. Not in the
 * state barrel: only the discussion panel's chunk imports it.
 */

export type RoomStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'failed';

export interface RoomState {
  readonly storyId: string | null;
  readonly status: RoomStatus;
  readonly info: DiscussionInfo | null;
  /** The signed-in reader's account id; null for a guest. */
  readonly readerId: string | null;
  /** Approved posts the reader can see, best first; the order never shifts under them. */
  readonly posts: readonly DiscussionPost[];
  /** The reader's own posts sent while the panel is open, newest first, shown above the rest. */
  readonly mine: readonly DiscussionPost[];
  /** Another page may follow. */
  readonly more: boolean;
  readonly loadingMore: boolean;
  readonly balance: RoomBalance | null;
  /** The three posts with the most helpful votes from the other side. */
  readonly topCrossSide: readonly DiscussionPost[];
  /** The reader's side; null for a guest or before they choose. */
  readonly stance: StanceRecord | null;
  readonly stanceBusy: boolean;
  /** The kinds of vote the reader has given each post, by post id. */
  readonly voted: Readonly<Record<string, readonly VoteKind[]>>;
  /** Posts that arrived live and have not been seen yet, for their highlight. */
  readonly fresh: readonly string[];
  readonly sending: boolean;
  /** Until when (monotonic ms) the posting limits hold the next post back; null when free. */
  readonly retryAtMs: number | null;
  /** What the panel's live region should say next. */
  readonly notice: string | null;
}

export type DiscussionRoomStore = StoreApi<RoomState>;

export const EMPTY_ROOM: RoomState = {
  storyId: null,
  status: 'idle',
  info: null,
  readerId: null,
  posts: [],
  mine: [],
  more: false,
  loadingMore: false,
  balance: null,
  topCrossSide: [],
  stance: null,
  stanceBusy: false,
  voted: {},
  fresh: [],
  sending: false,
  retryAtMs: null,
  notice: null,
};

export function createDiscussionRoomStore(): DiscussionRoomStore {
  return createStore<RoomState>()(() => EMPTY_ROOM);
}

/** The app's single room: one discussion is open at a time. */
export const discussionRoomStore: DiscussionRoomStore = createDiscussionRoomStore();

export function useDiscussionRoom<T>(selector: (state: RoomState) => T): T {
  return useStore(discussionRoomStore, selector);
}

/** A post with one more vote of `kind` counted, as the database will count it. */
export function withVote(post: DiscussionPost, kind: VoteKind, step: 1 | -1): DiscussionPost {
  return kind === 'helpful'
    ? { ...post, helpfulCount: Math.max(0, post.helpfulCount + step) }
    : { ...post, changedMindCount: Math.max(0, post.changedMindCount + step) };
}

/** Every list the post may be in, with `change` applied to it there. */
export function updatePost(
  state: RoomState,
  id: string,
  change: (post: DiscussionPost) => DiscussionPost,
): Pick<RoomState, 'posts' | 'mine' | 'topCrossSide'> {
  const apply = (list: readonly DiscussionPost[]): readonly DiscussionPost[] =>
    list.some((post) => post.id === id)
      ? list.map((post) => (post.id === id ? change(post) : post))
      : list;
  return {
    posts: apply(state.posts),
    mine: apply(state.mine),
    topCrossSide: apply(state.topCrossSide),
  };
}
