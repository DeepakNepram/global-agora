/**
 * db:smoke's discussion checks (Prompt 4.2), on the LOCAL stack: two
 * throwaway readers set up through 4.1's functions take opposite sides, post,
 * and vote across, through the typed client exactly as the app will. The
 * owner's steps (opening the discussion, approving posts as 4.3's moderation
 * will) go through the local REST API with the CLI's service key; the client
 * refuses service keys by design.
 */
import { randomUUID } from 'node:crypto';

import { createDbClient, type DbConfig } from '../../src/core/db/client.ts';
import { createAccountRemote } from '../../src/core/db/account.ts';

import { admin, createUser, signedIn, type Record, type TestUser } from './smoke-library.ts';

async function service(
  config: DbConfig,
  serviceKey: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
  });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${response.status}`);
  return response;
}

/** A reader who agreed to the rules, signed in. */
async function reader(config: DbConfig, serviceKey: string, name: string, users: TestUser[]) {
  const user = await createUser(config, serviceKey, name);
  users.push(user);
  const client = await signedIn(config, user);
  const account = createAccountRemote(client);
  await account.claimHandle(`smoke_${name}_${randomUUID().slice(0, 6)}`, true);
  await account.acceptRules();
  return client;
}

export async function discussionChecks(
  config: DbConfig,
  serviceKey: string,
  record: Record,
): Promise<void> {
  const users: TestUser[] = [];
  const anon = createDbClient(config, { persistSession: false });
  let storyId: string | null = null;
  try {
    const story = await anon
      .from('stories')
      .select('id')
      .eq('discussion_state', 'none')
      .limit(1)
      .single();
    if (story.error) throw new Error(`finding a story: ${story.error.message}`);
    storyId = story.data.id;
    await service(config, serviceKey, 'discussions', {
      method: 'POST',
      body: JSON.stringify({
        story_id: storyId,
        prompt: 'Smoke check?',
        side_a_label: 'Yes',
        side_b_label: 'No',
      }),
    });

    const a = await reader(config, serviceKey, 'a', users);
    const b = await reader(config, serviceKey, 'b', users);

    const noSide = await a
      .from('posts')
      .insert({ story_id: storyId, body: 'too soon', stance: 'a', kind: 'argument' });
    record(
      'no post before taking a side',
      noSide.error?.code === '42501',
      noSide.error?.message ?? 'POSTED',
    );

    await a.from('discussion_stances').insert({ story_id: storyId, stance: 'a' }).throwOnError();
    await b.from('discussion_stances').insert({ story_id: storyId, stance: 'b' }).throwOnError();
    const postA = await a
      .from('posts')
      .insert({ story_id: storyId, body: 'Smoke post from side a', stance: 'a', kind: 'argument' })
      .select('id, stance, mod_state')
      .single();
    const postB = await b
      .from('posts')
      .insert({ story_id: storyId, body: 'Smoke post from side b', stance: 'b', kind: 'expert' })
      .select('id, stance, mod_state')
      .single();
    record(
      "posts take their author's side and wait for moderation",
      postA.data?.stance === 'a' &&
        postB.data?.stance === 'b' &&
        postA.data.mod_state === 'pending',
      postA.error?.message ?? postB.error?.message ?? `${postA.data?.stance}/${postB.data?.stance}`,
    );
    const hidden = await anon.from('posts').select('id').eq('story_id', storyId);
    record('guests see no pending post', hidden.data?.length === 0, `${hidden.data?.length} posts`);

    await service(config, serviceKey, `posts?story_id=eq.${storyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ mod_state: 'ok' }),
    });
    const idA = postA.data?.id ?? '';
    const idB = postB.data?.id ?? '';
    await b.from('votes').insert({ post_id: idA, kind: 'helpful' }).throwOnError();
    await b.from('votes').insert({ post_id: idA, kind: 'changed_mind' }).throwOnError();
    const again = await b.from('votes').insert({ post_id: idA, kind: 'helpful' });
    record(
      'one helpful vote per person and post',
      again.error?.code === '23505',
      again.error?.message ?? 'TWICE',
    );
    const own = await b.from('votes').insert({ post_id: idB, kind: 'helpful' });
    record('no vote on your own post', own.error?.code === '42501', own.error?.message ?? 'VOTED');

    const ranked = await anon
      .from('posts')
      .select('id, helpful_count, cross_side_count, changed_mind_count, rank_score')
      .eq('story_id', storyId)
      .order('rank_score', { ascending: false });
    const top = ranked.data?.[0];
    record(
      'guests read the approved posts, best first, with their counts',
      ranked.data?.length === 2 &&
        top?.id === idA &&
        top.helpful_count === 1 &&
        top.cross_side_count === 1 &&
        top.changed_mind_count === 1,
      ranked.error?.message ?? `top ${top?.rank_score.toFixed(3)}`,
    );

    // Past its close time, before the close job has run: no more posts.
    const past = new Date(Date.now() - 60_000).toISOString();
    const opened = new Date(Date.now() - 3 * 3600_000).toISOString();
    await service(config, serviceKey, `discussions?story_id=eq.${storyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ opened_at: opened, closes_at: past }),
    });
    const late = await a
      .from('posts')
      .insert({ story_id: storyId, body: 'too late', stance: 'a', kind: 'argument' });
    record(
      'no post after the close time',
      late.error?.code === '42501',
      late.error?.message ?? 'POSTED',
    );
  } catch (error) {
    record('discussion checks ran', false, error instanceof Error ? error.message : String(error));
  } finally {
    for (const user of users) {
      await admin(config, serviceKey, `users/${user.id}`, { method: 'DELETE' });
    }
    if (storyId !== null) {
      await service(config, serviceKey, `discussions?story_id=eq.${storyId}`, { method: 'DELETE' });
    }
  }
}
