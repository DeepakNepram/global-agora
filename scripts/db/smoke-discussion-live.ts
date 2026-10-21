/**
 * db:smoke's live discussion checks (Prompt 4.5), on the LOCAL stack with
 * Realtime running: the app's own DiscussionRemote, as a guest and as
 * signed-in readers, against the real broadcast. A post approved by the
 * service role must reach a guest's live feed as its id, be readable by the
 * guest, stay unreadable to a reader who blocked its author, move the room's
 * balance, count a cross-side vote, and leave the feed as 'gone' when it is
 * removed.
 */
import { createDbClient, type DbConfig } from '../../src/core/db/client.ts';
import { createDiscussionRemote } from '../../src/core/db/discussion.ts';
import { createModerationRemote } from '../../src/core/db/moderation.ts';

import { service } from './smoke-discussion.ts';
import { admin, type Record, type TestUser } from './smoke-library.ts';
import { participant } from './smoke-moderation.ts';

/** How long a broadcast may take to arrive. */
const LIVE_WAIT_MS = 8000;
/** Time for the channel to join before anything is sent on it. */
const JOIN_MS = 2000;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves when `seen` holds `id`, or with false after LIVE_WAIT_MS. */
async function arrives(seen: Set<string>, id: string): Promise<{ ok: boolean; ms: number }> {
  const start = Date.now();
  while (Date.now() - start < LIVE_WAIT_MS) {
    if (seen.has(id)) return { ok: true, ms: Date.now() - start };
    await wait(25);
  }
  return { ok: false, ms: LIVE_WAIT_MS };
}

export async function liveDiscussionChecks(
  config: DbConfig,
  serviceKey: string,
  record: Record,
): Promise<void> {
  const users: TestUser[] = [];
  const stops: (() => void)[] = [];
  let storyId: string | null = null;
  try {
    const stories = (await (
      await service(config, serviceKey, 'stories?discussion_state=eq.none&select=id&limit=1', {
        method: 'GET',
      })
    ).json()) as { id: string }[];
    storyId = stories[0]?.id ?? null;
    if (storyId === null) throw new Error('no story to open a discussion on');
    const story = storyId;
    await service(config, serviceKey, 'discussions', {
      method: 'POST',
      body: JSON.stringify({
        story_id: story,
        prompt: 'Live smoke?',
        side_a_label: 'Yes',
        side_b_label: 'No',
      }),
    });

    // A guest and a reader who will have blocked the author, both listening.
    const guest = createDiscussionRemote(createDbClient(config, { persistSession: false }));
    const posts = new Set<string>();
    const gone = new Set<string>();
    stops.push(
      guest.subscribe(story, {
        onPost: (id) => posts.add(id),
        onGone: (id) => gone.add(id),
        onReconnect: () => undefined,
      }),
    );
    const author = await participant(config, serviceKey, 'live-author', users);
    const blocker = await participant(config, serviceKey, 'live-blocker', users);
    const voter = await participant(config, serviceKey, 'live-voter', users);
    await createModerationRemote(blocker.client).block(author.id);
    const blockerRemote = createDiscussionRemote(blocker.client);
    const voterRemote = createDiscussionRemote(voter.client);
    await wait(JOIN_MS);

    // The author takes side a and posts (straight in: the badge has its own checks).
    await createDiscussionRemote(author.client).takeSide(story, 'a', false);
    const { data: inserted, error } = await author.client
      .from('posts')
      .insert({
        story_id: story,
        body: 'Live smoke: a post for the feed.',
        kind: 'argument',
        stance: 'a',
      })
      .select('id')
      .single();
    if (error || !inserted) throw new Error(`post: ${error?.message ?? 'no row'}`);
    const id = inserted.id;
    record('a pending post is not broadcast', !posts.has(id), posts.has(id) ? 'SENT' : 'not sent');

    await service(config, serviceKey, `posts?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ mod_state: 'ok' }),
    });
    const live = await arrives(posts, id);
    record(
      'an approved post reaches a guest live',
      live.ok,
      live.ok ? `${live.ms} ms` : 'NOT RECEIVED',
    );

    const read = await guest.post(id);
    const hidden = await blockerRemote.post(id);
    record(
      'the guest reads it; a reader who blocked the author does not',
      read?.id === id && hidden === null,
      `guest ${read ? 'reads it' : 'NOTHING'}, blocker ${hidden ? 'READS IT' : 'nothing'}`,
    );

    const balance = await guest.balance(story);
    const blockerBalance = await blockerRemote.balance(story);
    record(
      'the balance counts it, except for the blocker',
      balance.a === 1 && blockerBalance.a === 0,
      `guest a=${balance.a}, blocker a=${blockerBalance.a}`,
    );

    await voterRemote.takeSide(story, 'b', false);
    await voterRemote.vote(id, 'helpful');
    const top = await guest.topCrossSide(story, 3);
    const stance = await voterRemote.myStance(story);
    record(
      'a helpful vote from the other side counts across sides, and fixes the side',
      top[0]?.id === id && top[0].crossSideCount === 1 && stance?.locked === true,
      `top ${top[0]?.crossSideCount ?? 'NONE'}, side ${stance?.locked ? 'fixed' : 'NOT FIXED'}`,
    );

    await service(config, serviceKey, `posts?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ mod_state: 'removed' }),
    });
    const left = await arrives(gone, id);
    record('a removed post leaves the feed', left.ok, left.ok ? `${left.ms} ms` : 'NOT RECEIVED');
  } catch (error) {
    record(
      'live discussion checks ran',
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    for (const stop of stops) stop();
    for (const user of users) {
      await admin(config, serviceKey, `users/${user.id}`, { method: 'DELETE' });
    }
    if (storyId !== null) {
      await service(config, serviceKey, `discussions?story_id=eq.${storyId}`, { method: 'DELETE' });
    }
  }
}
