/**
 * db:smoke's moderation checks (Prompt 4.3), on the LOCAL stack: the proof
 * that known-toxic posts are blocked. Every sample in
 * supabase/functions/_shared/moderation/samples.ts is posted by its own
 * throwaway reader through the typed client, as the app will, and goes the
 * whole way: the insert trigger, pg_net, the moderate-post Edge Function,
 * the models, record_moderation(). Then each verdict is checked.
 *
 * A model with no key in supabase/functions/.env is served by the stand-in
 * (moderation-stand-in.ts), replaying fixtures.json; each check says which
 * models were real. `npm run db:smoke -- --record` saves the real models'
 * replies into fixtures.json.
 *
 * The readers' own tools (reports, blocks, the posting limits) and the
 * admins' queue follow in smoke-moderation-tools.ts.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { createAccountRemote } from '../../src/core/db/account.ts';
import { createDbClient, type DbConfig } from '../../src/core/db/client.ts';
import { createModerationRemote } from '../../src/core/db/moderation.ts';
import {
  MODERATION_SAMPLES,
  type ModerationSample,
} from '../../supabase/functions/_shared/moderation/samples.ts';

import { service } from './smoke-discussion.ts';
import { admin, createUser, signedIn, type Record, type TestUser } from './smoke-library.ts';
import { FIXTURES_PATH, startStandIn } from './moderation-stand-in.ts';
import { toolChecks, type Participant, type Posted } from './smoke-moderation-tools.ts';

const VERDICT_WAIT_MS = 45_000;

/** A reader set up through 4.1's functions, signed in. */
export async function participant(
  config: DbConfig,
  serviceKey: string,
  name: string,
  users: TestUser[],
): Promise<Participant> {
  const user = await createUser(config, serviceKey, name);
  users.push(user);
  const client = await signedIn(config, user);
  const account = createAccountRemote(client);
  // Handles are at most 20 characters: sm_ + 10 of the name + _ + 4.
  const handle = `sm_${name.replace(/-/g, '').slice(0, 10)}_${randomUUID().slice(0, 4)}`;
  await account.claimHandle(handle, true);
  await account.acceptRules();
  return { id: user.id, client };
}

interface Verdict {
  readonly id: string;
  readonly mod_state: string;
  readonly mod_scores: { stand_ins?: string[]; openai?: unknown; google?: unknown } | null;
}

async function verdicts(config: DbConfig, serviceKey: string, ids: string[]): Promise<Verdict[]> {
  const deadline = Date.now() + VERDICT_WAIT_MS;
  for (;;) {
    const response = await service(
      config,
      serviceKey,
      `posts?id=in.(${ids.join(',')})&select=id,mod_state,mod_scores`,
      { method: 'GET', headers: {} },
    );
    const rows = (await response.json()) as Verdict[];
    if (rows.every((row) => row.mod_state !== 'pending') || Date.now() > deadline) return rows;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function meets(sample: ModerationSample, state: string, struck: boolean): boolean {
  switch (sample.expect) {
    case 'removed+strike':
      return state === 'removed' && struck;
    case 'removed':
      return state === 'removed' && !struck;
    case 'not-ok':
      return state === 'hidden' || state === 'removed';
    case 'ok':
      return state === 'ok';
  }
}

function models(verdict: Verdict | undefined): string {
  const standIns = verdict?.mod_scores?.stand_ins ?? [];
  return ['openai', 'google']
    .map((m) => `${m} ${standIns.includes(m) ? 'stand-in' : 'live'}`)
    .join(', ');
}

/** Saves the real models' replies to the samples (`--record`). */
function saveRecorded(posted: readonly Posted[], rows: readonly Verdict[]): string[] {
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as {
    [sample: string]: { [model: string]: { source: string; reply: unknown } };
  };
  const date = new Date().toISOString().slice(0, 10);
  const saved: string[] = [];
  for (const { sample, postId } of posted) {
    const row = rows.find((candidate) => candidate.id === postId);
    for (const model of ['openai', 'google'] as const) {
      const reply = row?.mod_scores?.[model];
      const entry = fixtures[sample.id];
      if (reply === undefined || entry === undefined) continue;
      if (row?.mod_scores?.stand_ins?.includes(model)) continue;
      entry[model] = { source: `recorded ${date}`, reply };
      saved.push(`${sample.id}/${model}`);
    }
  }
  writeFileSync(FIXTURES_PATH, `${JSON.stringify(fixtures, null, 2)}\n`);
  execSync(`npx prettier --write "${FIXTURES_PATH.pathname.replace(/^\/([A-Z]:)/, '$1')}"`);
  return saved;
}

export async function moderationChecks(
  config: DbConfig,
  serviceKey: string,
  record: Record,
  options: { readonly recordFixtures: boolean },
): Promise<void> {
  const users: TestUser[] = [];
  const anon = createDbClient(config, { persistSession: false });
  const standIn = await startStandIn().catch(() => null);
  record('the model stand-in listens on 54399', standIn !== null, standIn ? 'ok' : 'port busy');
  let storyId: string | null = null;
  try {
    const probe = await fetch(`${config.url}/functions/v1/moderate-post`, {
      method: 'POST',
      headers: { 'x-moderation-secret': 'wrong' },
      body: '{}',
    });
    record('the moderate-post function is served', probe.status === 401, `HTTP ${probe.status}`);

    const story = await anon.from('stories').select('id').eq('discussion_state', 'none').limit(1);
    storyId = story.data?.[0]?.id ?? null;
    if (storyId === null) throw new Error('no story to open a discussion on');
    await service(config, serviceKey, 'discussions', {
      method: 'POST',
      body: JSON.stringify({
        story_id: storyId,
        prompt: 'Moderation smoke?',
        side_a_label: 'Yes',
        side_b_label: 'No',
      }),
    });

    // One reader per sample: new accounts may post twice an hour.
    const posted: Posted[] = await Promise.all(
      MODERATION_SAMPLES.map(async (sample) => {
        const reader = await participant(config, serviceKey, sample.id, users);
        await reader.client
          .from('discussion_stances')
          .insert({ story_id: storyId ?? '', stance: 'a' })
          .throwOnError();
        const post = await reader.client
          .from('posts')
          .insert({ story_id: storyId ?? '', body: sample.text, stance: 'a', kind: 'argument' })
          .select('id')
          .single()
          .throwOnError();
        return { sample, postId: post.data.id, author: reader };
      }),
    );

    const rows = await verdicts(
      config,
      serviceKey,
      posted.map((p) => p.postId),
    );
    const strikes = (await (
      await service(
        config,
        serviceKey,
        `strikes?post_id=in.(${posted.map((p) => p.postId).join(',')})&select=post_id`,
        { method: 'GET', headers: {} },
      )
    ).json()) as { post_id: string }[];
    for (const { sample, postId } of posted) {
      const row = rows.find((candidate) => candidate.id === postId);
      const state = row?.mod_state ?? 'missing';
      const struck = strikes.some((strike) => strike.post_id === postId);
      record(
        `known ${sample.id} post: ${sample.expect}`,
        meets(sample, state, struck),
        `${state}${struck ? ' +strike' : ''}; ${models(row)}`,
      );
    }

    const threat = posted.find((p) => p.sample.id === 'threat');
    const notices = await createModerationRemote(threat?.author.client ?? anon).notices(5);
    const notice = notices[0];
    record(
      "the threat's author is told: removed, strike 1 of 3",
      notice?.kind === 'post_removed' && notice.strike && notice.strikes === 1,
      notice ? `${notice.kind}` : 'NO NOTICE',
    );

    if (options.recordFixtures) {
      const saved = saveRecorded(posted, rows);
      record(
        'real replies saved to fixtures.json',
        saved.length > 0,
        saved.join(' ') || 'none live',
      );
    }

    await toolChecks(config, serviceKey, record, { posted, storyId, users, participant });
  } catch (error) {
    record('moderation checks ran', false, error instanceof Error ? error.message : String(error));
  } finally {
    await standIn?.close();
    for (const user of users) {
      await admin(config, serviceKey, `users/${user.id}`, { method: 'DELETE' });
    }
    if (storyId !== null) {
      await service(config, serviceKey, `discussions?story_id=eq.${storyId}`, { method: 'DELETE' });
    }
  }
}
