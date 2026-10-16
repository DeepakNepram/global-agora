/**
 * db:smoke's moderation checks, continued (Prompt 4.3): a reader's tools
 * (reporting, blocking both ways, the posting limits) and an admin working
 * the queue, all through the typed client as the app will. Runs on the
 * posts smoke-moderation.ts left behind.
 */
import type { DbClient, DbConfig } from '../../src/core/db/client.ts';
import { createModerationRemote } from '../../src/core/db/moderation.ts';
import { createAdminRemote } from '../../src/core/db/moderationQueue.ts';
import { ModerationError, rateLimitWait } from '../../src/core/moderation.ts';
import type { ModerationSample } from '../../supabase/functions/_shared/moderation/samples.ts';

import { service } from './smoke-discussion.ts';
import type { Record, TestUser } from './smoke-library.ts';

export interface Participant {
  readonly id: string;
  readonly client: DbClient;
}

export interface Posted {
  readonly sample: ModerationSample;
  readonly postId: string;
  readonly author: Participant;
}

interface Context {
  readonly posted: readonly Posted[];
  readonly storyId: string;
  readonly users: TestUser[];
  readonly participant: (
    config: DbConfig,
    serviceKey: string,
    name: string,
    users: TestUser[],
  ) => Promise<Participant>;
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'none';
  } catch (error) {
    return error instanceof ModerationError ? error.code : String(error);
  }
}

async function sees(reader: Participant, postId: string): Promise<boolean> {
  const { data } = await reader.client.from('posts').select('id').eq('id', postId);
  return (data?.length ?? 0) === 1;
}

export async function toolChecks(
  config: DbConfig,
  serviceKey: string,
  record: Record,
  context: Context,
): Promise<void> {
  const by = (id: string): Posted | undefined => context.posted.find((p) => p.sample.id === id);
  const argument = by('argument');
  const eyewitness = by('eyewitness');
  const hardNews = by('hard-news');
  const borderline = by('borderline-insult');
  if (!argument || !eyewitness || !hardNews || !borderline) throw new Error('a sample is missing');
  const reporter = hardNews.author;
  const reporting = createModerationRemote(reporter.client);

  // --- Reports: once, on a post you can see. ---------------------------------
  const first = await codeOf(() => reporting.reportPost(argument.postId, 'off_topic'));
  const again = await codeOf(() => reporting.reportPost(argument.postId, 'spam'));
  record(
    'a reader reports a post, once',
    first === 'none' && again === 'already-reported',
    `${first}, then ${again}`,
  );

  // --- Blocks hide both ways. -----------------------------------------------
  const before = await sees(reporter, eyewitness.postId);
  await reporting.block(eyewitness.author.id);
  const blockerSees = await sees(reporter, eyewitness.postId);
  const blockedSees = await sees(eyewitness.author, hardNews.postId);
  record(
    'a block hides posts in both directions',
    before && !blockerSees && !blockedSees,
    `before ${before}; blocker ${blockerSees}, blocked ${blockedSees}`,
  );
  const listed = await reporting.blockedAccounts();
  await reporting.unblock(eyewitness.author.id);
  record(
    'and is listed, and can be lifted',
    listed.length === 1 &&
      listed[0]?.handle?.startsWith('sm_eyewitness') === true &&
      (await sees(reporter, eyewitness.postId)),
    `${listed.length} blocked`,
  );

  // --- The posting limits answer 429 with the wait. -------------------------
  const hasty = await context.participant(config, serviceKey, 'hasty', context.users);
  await hasty.client
    .from('discussion_stances')
    .insert({ story_id: context.storyId, stance: 'b' })
    .throwOnError();
  const post = (body: string) =>
    hasty.client
      .from('posts')
      .insert({ story_id: context.storyId, body, stance: 'b', kind: 'argument' });
  const firstPost = await post('A first, ordinary post.');
  const tooSoon = await post('And another straight after.');
  const wait = tooSoon.error ? rateLimitWait(tooSoon.error) : null;
  record(
    'a second post at once is refused with a wait (429)',
    firstPost.error === null && tooSoon.status === 429 && wait !== null && wait > 0 && wait <= 30,
    tooSoon.error ? `${tooSoon.status} ${tooSoon.error.code}, wait ${wait} s` : 'POSTED',
  );

  // --- An admin works the queue. --------------------------------------------
  const moderator = await context.participant(config, serviceKey, 'moderator', context.users);
  const notAdmin = await codeOf(() => createAdminRemote(moderator.client).queue(100));
  record('the queue refuses a reader', notAdmin === 'not-allowed', notAdmin);
  await service(config, serviceKey, 'admins', {
    method: 'POST',
    body: JSON.stringify({ user_id: moderator.id }),
  });
  const queue = createAdminRemote(moderator.client);
  const items = await queue.queue(100);
  const reported = items.find((item) => item.postId === argument.postId);
  const held = items.find((item) => item.postId === borderline.postId);
  // A live model may remove the borderline post outright; held, it is queued.
  const borderlineState = (
    (await (
      await service(config, serviceKey, `posts?id=eq.${borderline.postId}&select=mod_state`, {
        method: 'GET',
        headers: {},
      })
    ).json()) as { mod_state: string }[]
  )[0]?.mod_state;
  record(
    'the queue holds the reported post and the held one',
    reported?.queuedFor === 'reported' &&
      reported.reportReasons['off_topic'] === 1 &&
      (borderlineState === 'hidden' ? held?.queuedFor === 'hidden' : held === undefined),
    `${items.length} queued; reported ${reported?.queuedFor ?? 'MISSING'}, ` +
      `borderline ${borderlineState} ${held ? 'queued' : 'not queued'}`,
  );

  const kept = await queue.act(argument.postId, 'approve');
  const outcome = (await reporting.notices(5)).find((n) => n.kind === 'report_outcome');
  record(
    'approving a reported post tells the reporter it stays',
    kept === 'ok' && outcome?.kind === 'report_outcome' && outcome.outcome === 'kept',
    outcome ? `${kept}; ${outcome.kind}` : 'NO NOTICE',
  );
  if (held?.queuedFor === 'hidden') {
    const struck = await queue.act(borderline.postId, 'strike');
    const notice = (await createModerationRemote(borderline.author.client).notices(5))[0];
    record(
      'striking a held post removes it and tells its author',
      struck === 'removed' && notice?.kind === 'post_removed' && notice.strike,
      notice ? `${struck}; ${notice.kind}` : 'NO NOTICE',
    );
  }
}
