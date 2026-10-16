/**
 * db:smoke's local badge checks (Prompt 4.4), on the LOCAL stack: the app's
 * posting client, the API Worker's routes and the database together. The
 * Worker runs in-process (its handleFetch is free of Worker globals) on a
 * stand-in network, as `npm run api:dev` does, so nobody's real location is
 * involved; the posts go to the local PostgREST as real signed-in readers.
 */
import { createLogger } from '../../workers/shared/log.ts';
import { handleFetch, type ApiDeps } from '../../workers/api/src/app.ts';
import { createSwrCache } from '../../workers/api/src/cache.ts';
import { DEFAULT_API_CONFIG } from '../../workers/api/src/config.ts';
import { LOCAL_REGION_LABEL_SECRET } from '../../workers/api/src/posts.ts';
import type { DbConfig } from '../../src/core/db/client.ts';
import type { NetworkPlace } from '../../src/core/localBadge.ts';
import {
  fetchLocalBadge,
  PostingError,
  submitPost,
  type PostDraft,
} from '../../src/core/posting.ts';

import { service } from './smoke-discussion.ts';
import { admin, type Record, type TestUser } from './smoke-library.ts';
import { participant } from './smoke-moderation.ts';

const BENGALURU: NetworkPlace = { city: 'Bengaluru', country: 'IN' };
const NO_CITY: NetworkPlace = { city: null, country: 'IN' };

/** The Worker, called the way the app calls it, from a network of our choosing. */
function worker(config: DbConfig, network: NetworkPlace) {
  const deps: ApiDeps = {
    config: DEFAULT_API_CONFIG,
    db: null,
    cache: createSwrCache(),
    nodeStores: [],
    storyStores: [],
    now: () => Date.now(),
    waitUntil: () => undefined,
    log: createLogger({}, () => undefined),
    posting: {
      supabaseUrl: config.url,
      anonKey: config.anonKey,
      regionLabelSecret: LOCAL_REGION_LABEL_SECRET,
    },
    network,
    fetch: (input, init) => fetch(input, init),
  };
  return (url: string, init?: RequestInit): Promise<Response> =>
    handleFetch(new Request(`http://worker.local${url}`, init), deps);
}

async function tokenOf(reader: Awaited<ReturnType<typeof participant>>): Promise<string> {
  const { data } = await reader.client.auth.getSession();
  const token = data.session?.access_token;
  if (token === undefined) throw new Error('no session');
  return token;
}

export async function localBadgeChecks(
  config: DbConfig,
  serviceKey: string,
  record: Record,
): Promise<void> {
  const users: TestUser[] = [];
  let storyId: string | null = null;
  try {
    const badge = await fetchLocalBadge('/api', worker(config, BENGALURU));
    const none = await fetchLocalBadge('/api', worker(config, NO_CITY));
    record(
      'the Worker says what the badge would show',
      badge.label === 'Bengaluru area, India' && none.label === null && none.reason === 'no-city',
      `${badge.label ?? 'NONE'}; no city: ${none.label === null ? none.reason : none.label}`,
    );

    const stories = (await (
      await service(config, serviceKey, 'stories?discussion_state=eq.none&select=id&limit=1', {
        method: 'GET',
      })
    ).json()) as { id: string }[];
    storyId = stories[0]?.id ?? null;
    if (storyId === null) throw new Error('no story to open a discussion on');
    await service(config, serviceKey, 'discussions', {
      method: 'POST',
      body: JSON.stringify({
        story_id: storyId,
        prompt: 'Local badge smoke?',
        side_a_label: 'Yes',
        side_b_label: 'No',
      }),
    });

    // One reader per post: a new account may post twice an hour, 30 s apart.
    const send = async (name: string, network: NetworkPlace, localBadge: boolean) => {
      const reader = await participant(config, serviceKey, name, users);
      await reader.client
        .from('discussion_stances')
        .insert({ story_id: storyId ?? '', stance: 'a' })
        .throwOnError();
      const draft: PostDraft = {
        storyId: storyId ?? '',
        body: `Local badge smoke: ${name}.`,
        kind: 'argument',
        evidenceUrl: null,
        localBadge,
      };
      return {
        reader,
        post: await submitPost({
          apiBaseUrl: '/api',
          token: await tokenOf(reader),
          draft,
          fetch: worker(config, network),
        }),
      };
    };
    const stored = async (id: string): Promise<string | null | undefined> => {
      const rows = (await (
        await service(config, serviceKey, `posts?id=eq.${id}&select=region_label`, {
          method: 'GET',
        })
      ).json()) as { region_label: string | null }[];
      return rows[0]?.region_label;
    };

    const on = await send('badge-on', BENGALURU, true);
    record(
      'a post with the badge on stores its label',
      on.post.regionLabel === 'Bengaluru area, India' &&
        (await stored(on.post.id)) === 'Bengaluru area, India',
      `${on.post.regionLabel ?? 'NULL'} (${on.post.modState})`,
    );
    const off = await send('badge-off', BENGALURU, false);
    record(
      'a post with the badge off stores none',
      off.post.regionLabel === null && (await stored(off.post.id)) === null,
      off.post.regionLabel ?? 'null',
    );
    const dropped = await send('no-city', NO_CITY, true);
    record(
      'with no city the badge is left off, and the app is told',
      dropped.post.regionLabel === null && dropped.post.badgeDropped,
      `${dropped.post.regionLabel ?? 'null'}, dropped ${dropped.post.badgeDropped}`,
    );

    // Straight to the database, past the Worker, with a guessed secret.
    const forger = await participant(config, serviceKey, 'forger', users);
    await forger.client
      .from('discussion_stances')
      .insert({ story_id: storyId, stance: 'a' })
      .throwOnError();
    const forged = await fetch(`${config.url}/rest/v1/posts`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${await tokenOf(forger)}`,
        'content-type': 'application/json',
        'x-region-label': Buffer.from('Paris area, France').toString('base64'),
        'x-region-label-secret': 'guessed',
      },
      body: JSON.stringify({ story_id: storyId, body: 'Forged badge.', kind: 'argument' }),
    });
    record('a label without the Worker is refused', forged.status === 403, `HTTP ${forged.status}`);

    const again = await submitPost({
      apiBaseUrl: '/api',
      token: await tokenOf(on.reader),
      draft: {
        storyId,
        body: 'Straight after.',
        kind: 'argument',
        evidenceUrl: null,
        localBadge: true,
      },
      fetch: worker(config, BENGALURU),
    }).catch((error: unknown) => error);
    record(
      'the posting limits still apply through the Worker',
      again instanceof PostingError &&
        again.code === 'rate-limited' &&
        (again.retryAfterSeconds ?? 0) > 0,
      again instanceof PostingError ? `${again.code}, ${again.retryAfterSeconds} s` : 'POSTED',
    );
  } catch (error) {
    record('local badge checks ran', false, error instanceof Error ? error.message : String(error));
  } finally {
    for (const user of users) {
      await admin(config, serviceKey, `users/${user.id}`, { method: 'DELETE' });
    }
    if (storyId !== null) {
      await service(config, serviceKey, `discussions?story_id=eq.${storyId}`, {
        method: 'DELETE',
      });
    }
  }
}
