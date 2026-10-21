import { DiscussionError, type DiscussionPost, type VoteKind } from '@/core/discussion';
import { ModerationError, type ReportReason } from '@/core/moderation';
import {
  PostingError,
  type PostDraft,
  type PostingErrorCode,
  type PostStance,
  type SubmittedPost,
} from '@/core/posting';

import { accountStore } from './accountStore';
import type { RoomContext } from './discussionRoomController';
import { updatePost, withVote } from './discussionRoom';

/**
 * What a reader does in a discussion (Prompt 4.5): take a side, vote, post,
 * report and block. Each says plainly how it went, so the panel can explain;
 * the rules themselves are the database's.
 */

export type SideResult = 'ok' | 'signed-out' | 'locked' | 'failed';
export type VoteResult = 'ok' | 'signed-out' | 'no-side' | 'own' | 'already' | 'refused' | 'failed';
export type SendResult =
  | { readonly ok: true; readonly badgeDropped: boolean }
  | { readonly ok: false; readonly code: PostingErrorCode | 'no-side' };
export type ModerationResult = 'ok' | 'signed-out' | 'already' | 'gone' | 'failed';

export interface RoomActions {
  takeSide(stance: PostStance): Promise<SideResult>;
  vote(postId: string, kind: VoteKind): Promise<VoteResult>;
  send(draft: PostDraft): Promise<SendResult>;
  report(postId: string, reason: ReportReason): Promise<ModerationResult>;
  /** Hides the author's posts both ways; theirs leave the list at once. */
  block(authorId: string): Promise<ModerationResult>;
}

/** After sending, the post's moderation is checked this long after, until it is decided. */
export const OWN_POST_CHECKS_MS = [1500, 3000, 6000, 12_000, 24_000] as const;

/** A post just sent, as the list shows it before anything has voted on it. */
export function ownPost(
  sent: SubmittedPost,
  authorId: string,
  handle: string | null,
): DiscussionPost {
  return {
    id: sent.id,
    authorId,
    authorHandle: handle,
    body: sent.body,
    stance: sent.stance,
    kind: sent.kind,
    evidenceUrl: sent.evidenceUrl,
    regionLabel: sent.regionLabel,
    modState: sent.modState,
    helpfulCount: 0,
    crossSideCount: 0,
    changedMindCount: 0,
    rankScore: 0,
    createdAtMs: sent.createdAtMs,
  };
}

function moderationResult(error: unknown): ModerationResult {
  if (!(error instanceof ModerationError)) return 'failed';
  if (error.code === 'already-reported') return 'already';
  if (error.code === 'not-found') return 'gone';
  if (error.code === 'not-allowed') return 'signed-out';
  return 'failed';
}

export function createRoomActions(context: RoomContext): RoomActions {
  const { store, deps } = context;

  /** The open room's id and remotes, with a signed-in reader, or null. */
  const open = () => {
    const state = store.getState();
    const remotes = state.storyId === null ? null : context.remotesFor(state.storyId);
    return remotes && state.storyId !== null ? { state, storyId: state.storyId, remotes } : null;
  };

  const lockSide = (): void => {
    const { stance } = store.getState();
    if (stance && !stance.locked) store.setState({ stance: { ...stance, locked: true } });
  };

  const watchOwn = (storyId: string, id: string): void => {
    let decided = false;
    for (const ms of OWN_POST_CHECKS_MS) {
      context.later(() => {
        const remotes = context.remotesFor(storyId);
        if (decided || !remotes) return;
        void remotes.discussion.post(id).then(
          (post) => {
            if (!post || post.modState === 'pending' || context.remotesFor(storyId) === null)
              return;
            decided = true;
            store.setState({
              mine: store.getState().mine.map((own) => (own.id === id ? post : own)),
            });
          },
          () => undefined,
        );
      }, ms);
    }
  };

  return {
    async takeSide(stance) {
      const room = open();
      if (!room) return 'failed';
      if (room.state.readerId === null) return 'signed-out';
      if (room.state.stance?.locked) return 'locked';
      store.setState({ stanceBusy: true });
      try {
        await room.remotes.discussion.takeSide(room.storyId, stance, room.state.stance !== null);
        store.setState({ stance: { stance, locked: false }, stanceBusy: false });
        return 'ok';
      } catch (error) {
        store.setState({ stanceBusy: false });
        return error instanceof DiscussionError && error.code === 'signed-out'
          ? 'signed-out'
          : 'failed';
      }
    },

    async vote(postId, kind) {
      const room = open();
      if (!room) return 'failed';
      const { state } = room;
      if (state.readerId === null) return 'signed-out';
      if (state.stance === null) return 'no-side';
      const post = [...state.posts, ...state.topCrossSide].find((item) => item.id === postId);
      if (post?.authorId === state.readerId) return 'own';
      if (state.voted[postId]?.includes(kind)) return 'already';

      // Counted at once; taken back if the database says no.
      const given = (list: readonly VoteKind[] | undefined): VoteKind[] => [...(list ?? []), kind];
      store.setState({
        ...updatePost(state, postId, (item) => withVote(item, kind, 1)),
        voted: { ...state.voted, [postId]: given(state.voted[postId]) },
      });
      try {
        await room.remotes.discussion.vote(postId, kind);
        lockSide();
        context.refreshSoon();
        return 'ok';
      } catch (error) {
        const code = error instanceof DiscussionError ? error.code : 'unknown';
        if (code === 'already-done') return 'already';
        const now = store.getState();
        store.setState({
          ...updatePost(now, postId, (item) => withVote(item, kind, -1)),
          voted: {
            ...now.voted,
            [postId]: (now.voted[postId] ?? []).filter((other) => other !== kind),
          },
        });
        if (code === 'signed-out') return 'signed-out';
        return code === 'not-allowed' ? 'refused' : 'failed';
      }
    },

    async send(draft) {
      const room = open();
      if (!room) return { ok: false, code: 'unknown' };
      if (room.state.readerId === null) return { ok: false, code: 'signed-out' };
      if (room.state.stance === null) return { ok: false, code: 'no-side' };
      const readerId = room.state.readerId;
      store.setState({ sending: true });
      try {
        const sent = await room.remotes.posting.submit(draft);
        const post = ownPost(sent, readerId, accountStore.getState().profile?.handle ?? null);
        store.setState({ sending: false, mine: [post, ...store.getState().mine], retryAtMs: null });
        lockSide();
        if (post.modState === 'pending') watchOwn(room.storyId, post.id);
        return { ok: true, badgeDropped: sent.badgeDropped };
      } catch (error) {
        const failure = error instanceof PostingError ? error : null;
        store.setState({
          sending: false,
          retryAtMs:
            failure?.code === 'rate-limited'
              ? deps.now() + (failure.retryAfterSeconds ?? 60) * 1000
              : store.getState().retryAtMs,
        });
        return { ok: false, code: failure?.code ?? 'unknown' };
      }
    },

    async report(postId, reason) {
      const room = open();
      if (!room) return 'failed';
      if (room.state.readerId === null) return 'signed-out';
      try {
        await room.remotes.moderation.reportPost(postId, reason);
        return 'ok';
      } catch (error) {
        return moderationResult(error);
      }
    },

    async block(authorId) {
      const room = open();
      if (!room) return 'failed';
      if (room.state.readerId === null) return 'signed-out';
      try {
        await room.remotes.moderation.block(authorId);
      } catch (error) {
        return moderationResult(error);
      }
      const now = store.getState();
      const keep = (post: DiscussionPost): boolean => post.authorId !== authorId;
      store.setState({
        posts: now.posts.filter(keep),
        topCrossSide: now.topCrossSide.filter(keep),
        fresh: now.fresh.filter(
          (id) => now.posts.find((post) => post.id === id)?.authorId !== authorId,
        ),
      });
      context.refreshSoon();
      return 'ok';
    },
  };
}
