import {
  appendPage,
  insertByRank,
  type DiscussionPost,
  type DiscussionRemote,
  type MyVote,
  type VoteKind,
} from '@/core/discussion';
import type { ModerationRemote } from '@/core/moderation';
import type { PostingRemote } from '@/core/posting';

import { createRoomActions, type RoomActions } from './discussionRoomActions';
import { EMPTY_ROOM, type DiscussionRoomStore, type RoomState } from './discussionRoom';

/**
 * Fills the discussion room (Prompt 4.5): loads the debate, the first page of
 * posts, the room's balance and the reader's side and votes, then follows the
 * live feed. A live post arrives as an id and is read under RLS, so blocks
 * and moderation still decide who sees it; it goes in at its rank place and
 * nothing already shown moves.
 */

export const POSTS_PER_PAGE = 50;
export const TOP_CROSS_SIDE = 3;
/** Live posts and votes refresh the balance and the top three at most this often. */
const ROOM_REFRESH_MS = 1500;

export interface RoomRemotes {
  readonly discussion: DiscussionRemote;
  readonly posting: PostingRemote;
  readonly moderation: Pick<ModerationRemote, 'reportPost' | 'block'>;
}

export interface DiscussionRoomDeps {
  readonly store: DiscussionRoomStore;
  /** The SDK session's remotes; loading them may load the SDK. */
  readonly remotes: () => Promise<RoomRemotes>;
  /** Monotonic ms: the posting limits' countdown. */
  readonly now: () => number;
  readonly setTimer: (callback: () => void, ms: number) => number;
  readonly clearTimer: (handle: number) => void;
}

export interface DiscussionRoom extends RoomActions {
  open(storyId: string): Promise<void>;
  close(): void;
  showMore(): Promise<void>;
  /** Back after the tab was hidden: whatever the feed missed. */
  catchUp(): Promise<void>;
  /** The live highlight on a post has been seen. */
  seen(id: string): void;
}

/** The internals the actions share with the loader. */
export interface RoomContext {
  readonly store: DiscussionRoomStore;
  readonly deps: DiscussionRoomDeps;
  /** The open room's remotes, or null once it has closed or moved on. */
  remotesFor(storyId: string): RoomRemotes | null;
  refreshSoon(): void;
  later(callback: () => void, ms: number): void;
}

export function groupVotes(votes: readonly MyVote[]): Record<string, VoteKind[]> {
  const grouped: Record<string, VoteKind[]> = {};
  for (const vote of votes) (grouped[vote.postId] ??= []).push(vote.kind);
  return grouped;
}

export function createDiscussionRoom(deps: DiscussionRoomDeps): DiscussionRoom {
  const { store } = deps;
  let session: { storyId: string; remotes: RoomRemotes } | null = null;
  let generation = 0;
  let unsubscribe: (() => void) | null = null;
  let refreshTimer: number | null = null;
  const timers = new Set<number>();

  const later = (callback: () => void, ms: number): void => {
    const handle = deps.setTimer(() => {
      timers.delete(handle);
      callback();
    }, ms);
    timers.add(handle);
  };

  const refreshRoom = async (): Promise<void> => {
    const open = session;
    if (!open) return;
    const [balance, top] = await Promise.all([
      open.remotes.discussion.balance(open.storyId),
      open.remotes.discussion.topCrossSide(open.storyId, TOP_CROSS_SIDE),
    ]).catch(() => [null, null] as const);
    if (session !== open || balance === null || top === null) return;
    store.setState({ balance, topCrossSide: top });
  };

  const context: RoomContext = {
    store,
    deps,
    remotesFor: (storyId) => (session?.storyId === storyId ? session.remotes : null),
    refreshSoon() {
      if (refreshTimer !== null) return;
      refreshTimer = deps.setTimer(() => {
        refreshTimer = null;
        void refreshRoom();
      }, ROOM_REFRESH_MS);
    },
    later,
  };

  const arrive = async (id: string): Promise<void> => {
    const open = session;
    if (!open) return;
    const post = await open.remotes.discussion.post(id).catch(() => null);
    if (session !== open || post === null) return;
    const state = store.getState();
    if (state.mine.some((own) => own.id === id)) {
      store.setState({ mine: state.mine.map((own) => (own.id === id ? post : own)) });
      return;
    }
    const known = state.posts.some((shown) => shown.id === id);
    store.setState({
      posts: insertByRank(state.posts, post).list,
      ...(known ? {} : { fresh: [...state.fresh, id], notice: 'A new post arrived.' }),
    });
    context.refreshSoon();
  };

  const leaveRoom = (id: string): void => {
    const state = store.getState();
    store.setState({
      posts: state.posts.filter((post) => post.id !== id),
      topCrossSide: state.topCrossSide.filter((post) => post.id !== id),
      fresh: state.fresh.filter((fresh) => fresh !== id),
    });
    context.refreshSoon();
  };

  /** After the connection drops (a phone asleep), the first page shows what was missed. */
  const catchUp = async (): Promise<void> => {
    const open = session;
    if (!open) return;
    const page = await open.remotes.discussion
      .posts(open.storyId, 0, POSTS_PER_PAGE)
      .catch(() => null);
    if (session !== open || page === null) return;
    for (const post of page) {
      if (!store.getState().posts.some((shown) => shown.id === post.id)) void arrive(post.id);
    }
  };

  const close = (): void => {
    generation += 1;
    session = null;
    unsubscribe?.();
    unsubscribe = null;
    if (refreshTimer !== null) deps.clearTimer(refreshTimer);
    refreshTimer = null;
    for (const handle of timers) deps.clearTimer(handle);
    timers.clear();
    store.setState(EMPTY_ROOM, true);
  };

  return {
    ...createRoomActions(context),

    async open(storyId) {
      close();
      const opened = generation;
      store.setState({ ...EMPTY_ROOM, storyId, status: 'loading' }, true);
      try {
        const remotes = await deps.remotes();
        const { discussion } = remotes;
        const [info, page, balance, top, readerId] = await Promise.all([
          discussion.discussion(storyId),
          discussion.posts(storyId, 0, POSTS_PER_PAGE),
          discussion.balance(storyId),
          discussion.topCrossSide(storyId, TOP_CROSS_SIDE),
          discussion.readerId(),
        ]);
        if (generation !== opened) return;
        if (info === null) {
          store.setState({ status: 'missing' });
          return;
        }
        const ids = [...page, ...top].map((post: DiscussionPost) => post.id);
        const [stance, votes, unapproved] = readerId
          ? await Promise.all([
              discussion.myStance(storyId),
              discussion.myVotes(ids),
              discussion.myUnapproved(storyId),
            ])
          : [null, [], []];
        if (generation !== opened) return;
        session = { storyId, remotes };
        store.setState({
          status: 'ready',
          info,
          readerId,
          posts: page,
          more: page.length === POSTS_PER_PAGE,
          balance,
          topCrossSide: top,
          stance,
          voted: groupVotes(votes),
          mine: unapproved,
        });
        unsubscribe = discussion.subscribe(storyId, {
          onPost: (id) => void arrive(id),
          onGone: leaveRoom,
          onReconnect: () => void catchUp(),
        });
      } catch {
        if (generation === opened) store.setState({ status: 'failed' });
      }
    },

    close,
    catchUp,

    async showMore() {
      const open = session;
      const state = store.getState();
      if (!open || !state.more || state.loadingMore) return;
      store.setState({ loadingMore: true });
      try {
        const { discussion } = open.remotes;
        const page = await discussion.posts(open.storyId, state.posts.length, POSTS_PER_PAGE);
        const votes = state.readerId ? await discussion.myVotes(page.map((post) => post.id)) : [];
        if (session !== open) return;
        const now = store.getState();
        store.setState({
          posts: appendPage(now.posts, page),
          more: page.length === POSTS_PER_PAGE,
          voted: { ...now.voted, ...groupVotes(votes) },
          loadingMore: false,
        });
      } catch {
        if (session === open)
          store.setState({ loadingMore: false, notice: 'More posts could not be loaded.' });
      }
    },

    seen(id) {
      const { fresh } = store.getState();
      if (fresh.includes(id)) store.setState({ fresh: fresh.filter((other) => other !== id) });
    },
  };
}

export type { RoomState };
