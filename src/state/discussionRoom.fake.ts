import {
  DiscussionError,
  byRank,
  type DiscussionFeed,
  type DiscussionPost,
  type DiscussionRemote,
  type MyVote,
  type StanceRecord,
} from '@/core/discussion';
import { FIXTURE_DISCUSSION, fixtureBalance, fixturePosts } from '@/core/discussion.fixture';
import { ModerationError } from '@/core/moderation';
import { PostingError, type PostDraft, type SubmittedPost } from '@/core/posting';

import type { RoomRemotes } from './discussionRoomController';

/**
 * An in-memory discussion for tests and the dev benchmark: the fixture's
 * posts, a reader who may or may not be signed in, and a live feed the
 * caller drives (emit). Not a model of RLS beyond what the room relies on.
 */
export interface FakeRoom {
  remotes: RoomRemotes;
  posts: DiscussionPost[];
  readerId: string | null;
  stance: StanceRecord | null;
  votes: MyVote[];
  /** What the next send does: 'ok', 'pending' (moderation still running), or an error. */
  nextSend: 'ok' | 'pending' | PostingError;
  /** The next vote fails with this. */
  nextVoteError: DiscussionError | null;
  feeds: DiscussionFeed[];
  blocked: string[];
  sentDrafts: PostDraft[];
}

export function createFakeRoom(count = 60): FakeRoom {
  const fake: FakeRoom = {
    posts: fixturePosts(count),
    readerId: null,
    stance: null,
    votes: [],
    nextSend: 'ok',
    nextVoteError: null,
    feeds: [],
    blocked: [],
    sentDrafts: [],
    remotes: undefined as unknown as RoomRemotes,
  };
  const visible = (): DiscussionPost[] =>
    fake.posts.filter((post) => !fake.blocked.includes(post.authorId)).sort(byRank);

  const discussion: DiscussionRemote = {
    readerId: async () => fake.readerId,
    discussion: async (storyId) =>
      storyId === FIXTURE_DISCUSSION.storyId ? FIXTURE_DISCUSSION : null,
    posts: async (_storyId, offset, limit) => visible().slice(offset, offset + limit),
    post: async (id) => fake.posts.find((post) => post.id === id) ?? null,
    myUnapproved: async () =>
      fake.posts.filter(
        (post) =>
          post.authorId === fake.readerId && post.modState !== 'ok' && post.modState !== 'removed',
      ),
    topCrossSide: async (_storyId, limit) =>
      [...visible()]
        .filter((post) => post.crossSideCount > 0)
        .sort((a, b) => b.crossSideCount - a.crossSideCount)
        .slice(0, limit),
    balance: async () => fixtureBalance(visible()),
    myStance: async () => fake.stance,
    async takeSide(_storyId, stance) {
      if (fake.readerId === null) throw new DiscussionError('signed-out', 'signed out');
      if (fake.stance?.locked) throw new DiscussionError('not-allowed', 'locked');
      fake.stance = { stance, locked: false };
    },
    myVotes: async (ids) => fake.votes.filter((vote) => ids.includes(vote.postId)),
    async vote(postId, kind) {
      if (fake.nextVoteError) {
        const error = fake.nextVoteError;
        fake.nextVoteError = null;
        throw error;
      }
      fake.votes.push({ postId, kind });
      if (fake.stance) fake.stance = { ...fake.stance, locked: true };
    },
    subscribe(_storyId, feed) {
      fake.feeds.push(feed);
      return () => {
        fake.feeds = fake.feeds.filter((other) => other !== feed);
      };
    },
  };

  let sent = 0;
  fake.remotes = {
    discussion,
    posting: {
      localBadge: async () => ({ label: 'Bengaluru area, India' }),
      async submit(draft): Promise<SubmittedPost> {
        if (fake.nextSend instanceof PostingError) throw fake.nextSend;
        fake.sentDrafts.push(draft);
        sent += 1;
        const id = `00000000-0000-4000-a000-${String(sent).padStart(12, '0')}`;
        const post: SubmittedPost = {
          id,
          storyId: draft.storyId,
          body: draft.body,
          stance: fake.stance?.stance ?? 'neutral',
          kind: draft.kind,
          evidenceUrl: draft.evidenceUrl,
          regionLabel: draft.localBadge ? 'Bengaluru area, India' : null,
          modState: fake.nextSend === 'pending' ? 'pending' : 'ok',
          createdAtMs: Date.UTC(2026, 9, 20, 12),
          badgeDropped: false,
        };
        fake.posts.push({
          ...(fake.posts[0] as DiscussionPost),
          ...post,
          authorId: fake.readerId ?? '',
          authorHandle: 'me',
          helpfulCount: 0,
          crossSideCount: 0,
          changedMindCount: 0,
          rankScore: 0,
        });
        return post;
      },
    },
    moderation: {
      async reportPost(postId) {
        if (postId === 'reported-already') throw new ModerationError('already-reported', 'again');
      },
      async block(userId) {
        fake.blocked.push(userId);
      },
    },
  };
  return fake;
}
