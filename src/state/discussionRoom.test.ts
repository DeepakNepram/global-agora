import { describe, expect, it } from 'vitest';

import { DiscussionError } from '@/core/discussion';
import { FIXTURE_STORY_ID } from '@/core/discussion.fixture';
import { PostingError, type PostDraft } from '@/core/posting';

import { createDiscussionRoomStore } from './discussionRoom';
import { createFakeRoom } from './discussionRoom.fake';
import { OWN_POST_CHECKS_MS } from './discussionRoomActions';
import { createDiscussionRoom, POSTS_PER_PAGE } from './discussionRoomController';

/** Timers that run only when the test advances them. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimer: (run: () => void, ms: number) => {
      const id = next++;
      pending.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id: number) => void pending.delete(id),
    async advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now) continue;
        pending.delete(id);
        timer.run();
        await Promise.resolve();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

async function setup(options: { signedIn?: boolean; posts?: number } = {}) {
  const fake = createFakeRoom(options.posts ?? 60);
  if (options.signedIn) fake.readerId = 'reader-1';
  const store = createDiscussionRoomStore();
  const timers = fakeTimers();
  const room = createDiscussionRoom({
    store,
    remotes: async () => fake.remotes,
    now: timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  await room.open(FIXTURE_STORY_ID);
  return { fake, store, timers, room };
}

const draft = (body = 'A point worth making.'): PostDraft => ({
  storyId: FIXTURE_STORY_ID,
  body,
  kind: 'argument',
  evidenceUrl: null,
  localBadge: false,
});

describe('opening a discussion', () => {
  it('loads the debate, the first page best first, the balance and the top three', async () => {
    const { store } = await setup();
    const state = store.getState();
    expect(state.status).toBe('ready');
    expect(state.info?.prompt).toMatch(/market/);
    expect(state.posts).toHaveLength(POSTS_PER_PAGE);
    expect(state.more).toBe(true);
    expect(state.balance).not.toBeNull();
    expect(state.topCrossSide).toHaveLength(3);
    expect(state.readerId).toBeNull();
    expect(state.stance).toBeNull();
  });

  it('says so when the story has no discussion', async () => {
    const { store, room } = await setup();
    await room.open('no-such-story');
    expect(store.getState().status).toBe('missing');
  });

  it('shows more on request, without repeating a post', async () => {
    const { store, room } = await setup();
    await room.showMore();
    const ids = store.getState().posts.map((post) => post.id);
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
    expect(store.getState().more).toBe(false);
  });
});

describe('taking a side', () => {
  it('needs an account', async () => {
    const { room } = await setup();
    expect(await room.takeSide('a')).toBe('signed-out');
  });

  it('records the side, may change it, and is fixed by the first vote', async () => {
    const { store, room } = await setup({ signedIn: true });
    expect(await room.takeSide('a')).toBe('ok');
    expect(await room.takeSide('b')).toBe('ok');
    expect(store.getState().stance).toEqual({ stance: 'b', locked: false });
    const post = store.getState().posts[2];
    if (!post) throw new Error('no post');
    expect(await room.vote(post.id, 'helpful')).toBe('ok');
    expect(store.getState().stance?.locked).toBe(true);
    expect(await room.takeSide('a')).toBe('locked');
  });
});

describe('voting', () => {
  it('needs a side first', async () => {
    const { store, room } = await setup({ signedIn: true });
    expect(await room.vote(store.getState().posts[0]?.id ?? '', 'helpful')).toBe('no-side');
  });

  it('counts at once, once per kind', async () => {
    const { store, room } = await setup({ signedIn: true });
    await room.takeSide('neutral');
    const post = store.getState().posts[4];
    if (!post) throw new Error('no post');
    expect(await room.vote(post.id, 'changed_mind')).toBe('ok');
    const counted = store.getState().posts.find((item) => item.id === post.id);
    expect(counted?.changedMindCount).toBe(post.changedMindCount + 1);
    expect(store.getState().voted[post.id]).toEqual(['changed_mind']);
    expect(await room.vote(post.id, 'changed_mind')).toBe('already');
  });

  it('takes the vote back when the database refuses it', async () => {
    const { fake, store, room } = await setup({ signedIn: true });
    await room.takeSide('a');
    const post = store.getState().posts[1];
    if (!post) throw new Error('no post');
    fake.nextVoteError = new DiscussionError('not-allowed', 'closed');
    expect(await room.vote(post.id, 'helpful')).toBe('refused');
    expect(store.getState().posts.find((item) => item.id === post.id)?.helpfulCount).toBe(
      post.helpfulCount,
    );
    expect(store.getState().voted[post.id]).toEqual([]);
  });
});

describe('posting', () => {
  it('puts the new post on top, and follows its moderation', async () => {
    const { fake, store, timers, room } = await setup({ signedIn: true });
    await room.takeSide('a');
    fake.nextSend = 'pending';
    const result = await room.send(draft());
    expect(result).toEqual({ ok: true, badgeDropped: false });
    const [mine] = store.getState().mine;
    expect(mine?.modState).toBe('pending');
    expect(store.getState().stance?.locked).toBe(true);

    fake.posts = fake.posts.map((post) =>
      post.id === mine?.id ? { ...post, modState: 'ok' } : post,
    );
    await timers.advance(OWN_POST_CHECKS_MS[0]);
    expect(store.getState().mine[0]?.modState).toBe('ok');
  });

  it('holds the next post back for the wait the limits give', async () => {
    const { fake, store, room } = await setup({ signedIn: true });
    await room.takeSide('b');
    fake.nextSend = new PostingError('rate-limited', 'slow down', 42);
    expect(await room.send(draft())).toEqual({ ok: false, code: 'rate-limited' });
    expect(store.getState().retryAtMs).toBe(42_000);
  });

  it('needs a side', async () => {
    const { room } = await setup({ signedIn: true });
    expect(await room.send(draft())).toEqual({ ok: false, code: 'no-side' });
  });
});

describe('the live feed', () => {
  it('puts a new post at its rank place, highlighted, once however often it is announced', async () => {
    const { fake, store } = await setup({ posts: 10 });
    const before = store.getState().posts.map((post) => post.id);
    const arrived = {
      ...(fake.posts[0] ?? fake.posts[1]!),
      id: 'live-1',
      rankScore: -1,
      createdAtMs: 0,
    };
    fake.posts.push(arrived);
    fake.feeds[0]?.onPost('live-1');
    fake.feeds[0]?.onPost('live-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = store.getState().posts.map((post) => post.id);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.filter((id) => id === 'live-1')).toHaveLength(1);
    expect(store.getState().fresh).toEqual(['live-1']);
  });

  it('drops a post that is removed', async () => {
    const { fake, store } = await setup({ posts: 10 });
    const gone = store.getState().posts[3]?.id ?? '';
    fake.feeds[0]?.onGone(gone);
    expect(store.getState().posts.some((post) => post.id === gone)).toBe(false);
  });

  it('stops listening when the room closes', async () => {
    const { fake, room } = await setup();
    expect(fake.feeds).toHaveLength(1);
    room.close();
    expect(fake.feeds).toHaveLength(0);
  });
});

describe('blocking', () => {
  it("takes the author's posts out of the list at once", async () => {
    const { store, room } = await setup({ signedIn: true });
    const author = store.getState().posts[0]?.authorId ?? '';
    expect(await room.block(author)).toBe('ok');
    expect(store.getState().posts.some((post) => post.authorId === author)).toBe(false);
    expect(store.getState().topCrossSide.some((post) => post.authorId === author)).toBe(false);
  });

  it('says when a post was reported already', async () => {
    const { room } = await setup({ signedIn: true });
    expect(await room.report('reported-already', 'spam')).toBe('already');
  });
});
