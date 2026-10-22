/**
 * db:smoke's admin console checks (Prompt 4.6), on the LOCAL stack: a
 * throwaway admin and a reader, through the typed client and the real
 * suggest-debate Edge Function, as the console uses them. Claude is the
 * local stand-in (debate-stand-in.ts) unless ANTHROPIC_API_KEY is set in
 * supabase/functions/.env; the check says which answered.
 *
 * What it changes it puts back: the opened discussion goes and its story
 * is queued again, the moved story returns to its place, and the admin log
 * loses the rows it wrote.
 */
import { ADMIN_PAGE, AdminError, localMidnight, type DebateDraft } from '../../src/core/admin.ts';
import { createAdminConsoleRemote } from '../../src/core/db/admin.ts';
import { createDbClient, type DbConfig } from '../../src/core/db/client.ts';

import { startDebateStandIn, STAND_IN_SUGGESTION } from './debate-stand-in.ts';
import { service } from './smoke-discussion.ts';
import { admin, type Record, type TestUser } from './smoke-library.ts';
import { participant } from './smoke-moderation.ts';

const DRAFT: DebateDraft = {
  prompt: 'Smoke: should this go ahead?',
  sideA: 'Go ahead',
  sideB: 'Stop it',
};
const HOUR_MS = 3_600_000;

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'none';
  } catch (error) {
    return error instanceof AdminError ? error.code : String(error);
  }
}

interface StoryPlace {
  readonly id: string;
  readonly seq: number;
  readonly lat: number;
  readonly lon: number;
  readonly place_name: string | null;
  readonly country_code: string | null;
  readonly place_source: string | null;
  readonly place_conf: number | null;
}

export async function adminConsoleChecks(
  config: DbConfig,
  serviceKey: string,
  record: Record,
): Promise<void> {
  const users: TestUser[] = [];
  const anon = createDbClient(config, { persistSession: false });
  const standIn = await startDebateStandIn();
  let adminId: string | null = null;
  let opened: string | null = null;
  let moved: StoryPlace | null = null;
  try {
    const moderator = await participant(config, serviceKey, 'console', users);
    adminId = moderator.id;
    await service(config, serviceKey, 'admins', {
      method: 'POST',
      body: JSON.stringify({ user_id: moderator.id }),
    });
    const reader = await participant(config, serviceKey, 'console-reader', users);
    const asAdmin = createAdminConsoleRemote(moderator.client);
    const asReader = createAdminConsoleRemote(reader.client);

    // --- Who may use it. ------------------------------------------------------
    const stories = await asAdmin.storyQueue(ADMIN_PAGE);
    const target = stories[0];
    if (target === undefined) throw new Error('the seed has no queued story');
    const refusedQueue = await codeOf(() => asReader.storyQueue(10));
    const refusedSuggest = await codeOf(() => asReader.suggest(target.storyId));
    record(
      'a reader is refused the console and suggestions',
      refusedQueue === 'not-admin' &&
        refusedSuggest === 'not-admin' &&
        standIn.requests.length === 0,
      `queue ${refusedQueue}, suggest ${refusedSuggest}, model asked ${standIn.requests.length}×`,
    );

    // --- The queue and the counters. --------------------------------------------
    const hottestFirst = stories.every(
      (story, i) => i === 0 || (stories[i - 1]?.heat ?? 0) >= story.heat,
    );
    record(
      'an admin reads the hot story queue, hottest first',
      stories.length > 0 && hottestFirst,
      `${stories.length} queued, top heat ${target.heat}`,
    );
    const before = await asAdmin.counters(localMidnight(Date.now()));
    record(
      'an admin reads the counters',
      before.maxOpen > 0 && before.medianWindowDays > 0,
      `${before.openDiscussions} of ${before.maxOpen} open, ${before.postsToday} posts today`,
    );

    // --- A suggestion through the real Edge Function. -----------------------
    const started = performance.now();
    const suggestion = await asAdmin.suggest(target.storyId);
    const took = Math.round(performance.now() - started);
    const sent = standIn.requests[0];
    if (sent !== undefined) {
      const format = (sent.body['output_config'] as { format?: { type?: string } } | undefined)
        ?.format;
      record(
        'the function suggests a debate (stand-in model)',
        suggestion.kind === 'ok' && suggestion.draft.prompt === STAND_IN_SUGGESTION.prompt,
        `${suggestion.kind} in ${took} ms`,
      );
      record(
        'it asks for structured output, with the refusal fallback',
        sent.body['fallbacks'] === 'default' &&
          sent.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01' &&
          format?.type === 'json_schema' &&
          JSON.stringify(sent.body['messages']).includes(target.title),
        `beta ${String(sent.headers['anthropic-beta'])}, format ${format?.type ?? 'none'}`,
      );
    } else {
      // A key is set: Claude itself answered, or could not be reached.
      record(
        'the function suggests a debate (live Claude)',
        suggestion.kind === 'ok',
        suggestion.kind === 'ok'
          ? `“${suggestion.draft.prompt}” in ${took} ms`
          : `no suggestion: ${suggestion.reason}`,
      );
    }

    // --- Opening, once. ---------------------------------------------------------
    const result = await asAdmin.openDiscussion(target.storyId, DRAFT);
    opened = target.storyId;
    const { data: seen } = await anon
      .from('discussions')
      .select('prompt, opened_at, closes_at, state')
      .eq('story_id', target.storyId)
      .single();
    const hours = seen ? (Date.parse(seen.closes_at) - Date.parse(seen.opened_at)) / HOUR_MS : 0;
    record(
      'an admin opens a discussion for 48 hours, and readers see it',
      seen?.prompt === DRAFT.prompt && seen.state === 'open' && Math.abs(hours - 48) < 0.01,
      `${seen?.state ?? 'not found'}, ${hours.toFixed(2)} h, ${result.openCount} of ${result.maxOpen} open`,
    );
    const again = await codeOf(() => asAdmin.openDiscussion(target.storyId, DRAFT));
    const after = await asAdmin.counters(localMidnight(Date.now()));
    record(
      'a story opens once, and the counters count it',
      again === 'not-queued' && after.openDiscussions === before.openDiscussions + 1,
      `again: ${again}; open ${before.openDiscussions} → ${after.openDiscussions}`,
    );

    // --- Correcting a reported location. ---------------------------------------
    const { data: victim } = await anon
      .from('stories')
      .select('id, seq, lat, lon, place_name, country_code, place_source, place_conf')
      .eq('discussion_state', 'none')
      .order('seq')
      .limit(1)
      .single();
    if (victim === null) throw new Error('the seed has no unqueued story');
    moved = victim;
    await anon.rpc('api_report_location', { p_seq: victim.seq });
    await anon.rpc('api_report_location', { p_seq: victim.seq });
    const reported = (await asAdmin.locationQueue(ADMIN_PAGE)).find((i) => i.storyId === victim.id);
    const answered = await asAdmin.fixLocation(victim.id, {
      lat: 12.97,
      lon: 77.59,
      placeName: 'Bengaluru',
      countryCode: 'IN',
    });
    const { data: card } = await anon.rpc('api_story', { p_seq: victim.seq });
    const place = (card as { place?: { name?: string; source?: string; lat?: number } } | null)
      ?.place;
    record(
      'an admin moves a reported pin, and the story card follows',
      (reported?.reports ?? 0) >= 2 &&
        answered === reported?.reports &&
        place?.name === 'Bengaluru' &&
        place.source === 'manual' &&
        place.lat === 12.97,
      `${reported?.reports ?? 0} reports, ${answered} answered; card: ${place?.name ?? '?'} (${place?.source ?? '?'})`,
    );
  } finally {
    await standIn.close();
    if (opened !== null) {
      await service(config, serviceKey, `discussions?story_id=eq.${opened}`, { method: 'DELETE' });
      await service(config, serviceKey, `stories?id=eq.${opened}`, {
        method: 'PATCH',
        body: JSON.stringify({ discussion_state: 'queued' }),
      });
    }
    if (moved !== null) {
      const { id, seq: _seq, ...place } = moved;
      await service(config, serviceKey, `stories?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify(place),
      });
    }
    if (adminId !== null) {
      await service(config, serviceKey, `admin_actions?actor_id=eq.${adminId}`, {
        method: 'DELETE',
      });
    }
    for (const user of users) {
      await admin(config, serviceKey, `users/${user.id}`, { method: 'DELETE' });
    }
  }
}
