import type { Page, Route } from '@playwright/test';

import type { Database } from '@/core/db/types';

import { CLOSED_DISCUSSION_UUID, OPEN_DISCUSSION_UUID, stories } from './news';

/**
 * A stand-in for Supabase (auth, PostgREST, Edge Functions, Realtime), so
 * the checks can reach every state the app has, signed in or not, with no
 * database (Prompt 5.1). Rows are typed against the generated schema, so a
 * migration that changes them fails the typecheck here first.
 */

type Rpc = Database['public']['Functions'];

/** Who the page belongs to. */
export interface Persona {
  readonly signedIn: boolean;
  /** Null before the reader has chosen a handle: the setup sheet. */
  readonly handle?: string | null;
  readonly admin?: boolean;
  /** Has taken a side in the open discussion. */
  readonly side?: 'a' | 'b' | 'neutral' | null;
  /** Suspended after three strikes, with no appeal yet (Prompt 5.2). */
  readonly suspended?: boolean;
}

export const GUEST: Persona = { signedIn: false };
export const READER: Persona = { signedIn: true, handle: 'river_reader', side: 'a' };
export const ADMIN: Persona = { signedIn: true, handle: 'desk_editor', admin: true };
export const SUSPENDED: Persona = { signedIn: true, handle: 'struck_reader', suspended: true };

const USER_ID = '11111111-1111-4111-8111-111111111111';

function iso(secondsAgo: number): string {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function user(): Record<string, unknown> {
  return {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'reader@example.test',
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: iso(86_400 * 30),
  };
}

/**
 * The stored session the SDK starts from: built here, at run time, with an
 * unsigned token (the stand-in never checks it), so no key-shaped literal
 * lives in the repository.
 */
export function storedSession(): string {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600 * 12;
  const accessToken = [
    base64url({ alg: 'none', typ: 'JWT' }),
    base64url({ sub: USER_ID, role: 'authenticated', exp: expiresAt, aud: 'authenticated' }),
    'e2e',
  ].join('.');
  return JSON.stringify({
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600 * 12,
    expires_at: expiresAt,
    refresh_token: 'e2e-refresh',
    user: user(),
  });
}

function profile(persona: Persona): Rpc['my_profile']['Returns'] {
  // No handle yet: no profile row, and setup starts at its first step.
  if (!persona.signedIn || !persona.handle) return [];
  return [
    {
      created_at: iso(86_400 * 30),
      display_name: persona.handle,
      handle: persona.handle,
      is_admin: persona.admin === true,
      is_adult: true,
      // After the rules' last update (communityRules.ts), or setup asks again.
      rules_accepted_at: iso(86_400),
      strikes: persona.suspended ? 3 : 0,
      suspended_at: persona.suspended ? iso(86_400) : (null as unknown as string),
      tier: 'free',
      // No appeal (Prompt 5.2). The generated types say string; PostgREST sends null.
      appeal_status: null as unknown as string,
      appeal_sent_at: null as unknown as string,
      appeal_reply: null as unknown as string,
      appeal_again_at: null as unknown as string,
    },
  ];
}

const DISCUSSION = {
  story_id: OPEN_DISCUSSION_UUID,
  prompt: 'Should the city fund the new ferry line?',
  side_a_label: 'Fund it',
  side_b_label: 'Spend it elsewhere',
  state: 'open',
  closes_at: new Date(Date.now() + 36 * 3600 * 1000).toISOString(),
  post_count: 4,
};

const CLOSED_DISCUSSION = {
  ...DISCUSSION,
  story_id: CLOSED_DISCUSSION_UUID,
  prompt: 'Was the harbour toll worth it?',
  state: 'closed',
  closes_at: new Date(Date.now() - 3600 * 1000).toISOString(),
};

function posts(): Record<string, unknown>[] {
  const bodies: readonly [string, string, string][] = [
    ['a', 'argument', 'Commuters on the north shore lose an hour a day; a ferry fixes that.'],
    ['b', 'evidence', 'The last ferry pilot ran at a third of capacity for two years.'],
    ['neutral', 'eyewitness', 'I ride the bus across the bridge daily; it is slow but reliable.'],
    ['a', 'expert', 'Ferries pay off where bridges are congested and land is scarce.'],
  ];
  return bodies.map(([stance, kind, body], i) => ({
    id: `22222222-2222-4222-8222-00000000000${i + 1}`,
    author_id: `33333333-3333-4333-8333-00000000000${i + 1}`,
    body,
    stance,
    kind,
    evidence_url: kind === 'evidence' ? 'https://transit-data.example/report' : null,
    region_label: i === 2 ? 'Harbour district, Kenya' : null,
    mod_state: 'ok',
    helpful_count: 4 - i,
    cross_side_count: 2 - (i % 2),
    changed_mind_count: i % 3,
    rank_score: 10 - i,
    created_at: iso(600 * (i + 1)),
    author: { handle: `voice_${i + 1}` },
  }));
}

/** GET rows of a table, as PostgREST answers. */
function table(name: string, persona: Persona, query: URLSearchParams): unknown[] {
  switch (name) {
    case 'discussions':
      return [
        query.get('story_id') === `eq.${CLOSED_DISCUSSION_UUID}` ? CLOSED_DISCUSSION : DISCUSSION,
      ];
    case 'posts':
      return posts();
    case 'discussion_stances':
      return persona.signedIn && persona.side ? [{ stance: persona.side, locked_at: null }] : [];
    case 'saved_stories':
      return [];
    case 'follows':
      return [];
    default:
      return [];
  }
}

function rpc(name: string, persona: Persona, args: Record<string, unknown>): unknown {
  const top = stories().slice(-6).reverse();
  switch (name) {
    case 'my_profile':
      return profile(persona);
    case 'handles_available':
      return args['p_handles'] ?? [];
    case 'discussion_balance': {
      const balance: Rpc['discussion_balance']['Returns'] = [
        { stance: 'a', posts: 2 },
        { stance: 'b', posts: 1 },
        { stance: 'neutral', posts: 1 },
      ];
      return balance;
    }
    case 'discussion_participants':
      return 3;
    case 'admin_story_queue': {
      const queue: Rpc['admin_story_queue']['Returns'] = top.map((s) => ({
        story_id: `00000000-0000-4000-8000-${String(s.seq).padStart(12, '0')}`,
        seq: s.seq,
        title: s.title,
        summary: null as unknown as string,
        heat: s.heat,
        source_count: s.sources,
        location_reports: 0,
        place_name: s.place,
        country_code: s.countryCode,
        published_at: new Date(s.publishedSec * 1000).toISOString(),
      }));
      return queue;
    }
    case 'admin_counters': {
      const counters: Rpc['admin_counters']['Returns'] = [
        {
          open_discussions: 1,
          max_open: 25,
          next_close_at: DISCUSSION.closes_at,
          posts_today: 12,
          reports_open: 2,
          median_action_seconds: 340,
          reports_resolved: 9,
          median_window_days: 7,
        },
      ];
      return counters;
    }
    case 'admin_location_queue': {
      const reported: Rpc['admin_location_queue']['Returns'] = top.slice(0, 3).map((s, i) => ({
        story_id: `00000000-0000-4000-8000-${String(s.seq).padStart(12, '0')}`,
        seq: s.seq,
        title: s.title,
        lat: s.lat,
        lon: s.lon,
        place_name: s.place,
        place_source: 'gdelt',
        country_code: s.countryCode,
        published_at: new Date(s.publishedSec * 1000).toISOString(),
        reports: 3 - i,
        last_reported_at: iso(900 * (i + 1)),
      }));
      return reported;
    }
    case 'moderation_queue':
      return [];
    case 'submit_appeal':
      return '44444444-4444-4444-8444-000000000001';
    case 'decide_appeal':
      return args['p_grant'] === true ? 'granted' : 'refused';
    case 'admin_appeals': {
      const appeals: Rpc['admin_appeals']['Returns'] = [
        {
          id: '44444444-4444-4444-8444-000000000001',
          user_id: '33333333-3333-4333-8333-000000000009',
          handle: 'struck_reader',
          body: 'The second post quoted the article; it was not my own words.',
          status: 'pending',
          created_at: iso(3600),
          decided_at: null as unknown as string,
          reply: null as unknown as string,
          strikes: 3,
          suspended_at: iso(86_400),
          removed_posts: [{ body: 'A quoted line from the article.', created_at: iso(90_000) }],
        },
      ];
      return appeals;
    }
    default:
      return null;
  }
}

async function fulfilJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/*' },
    body: JSON.stringify(body),
  });
}

/** Answers everything the app asks of Supabase at `origin`, as `persona`. */
export async function routeBackend(page: Page, origin: string, persona: Persona): Promise<void> {
  // Realtime: accepted and left quiet. Live posts are not what these checks are about.
  await page.routeWebSocket(new RegExp(`^wss?://${new URL(origin).host}/realtime/`), () => {});

  await page.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
      return;
    }

    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/user')) return fulfilJson(route, user());
      if (url.pathname.endsWith('/token')) return fulfilJson(route, JSON.parse(storedSession()));
      return fulfilJson(route, {});
    }

    if (url.pathname.startsWith('/functions/v1/suggest-debate')) {
      return fulfilJson(route, {
        suggestion: {
          prompt: 'Should the city fund the new ferry line?',
          sideA: 'Fund it',
          sideB: 'Spend it elsewhere',
        },
        reason: 'ok',
      });
    }

    const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpcMatch) {
      const args = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      return fulfilJson(route, rpc(rpcMatch[1] ?? '', persona, args));
    }

    const tableMatch = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (tableMatch) {
      if (method === 'HEAD') {
        await route.fulfill({
          status: 200,
          headers: { 'access-control-allow-origin': '*', 'content-range': '*/0' },
        });
        return;
      }
      if (method !== 'GET') {
        const body: unknown = request.postDataJSON();
        return fulfilJson(route, Array.isArray(body) ? body : body ? [body] : [], 201);
      }
      const rows = table(tableMatch[1] ?? '', persona, url.searchParams);
      const single = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      return fulfilJson(route, single ? (rows[0] ?? null) : rows);
    }

    await route.fulfill({ status: 404, body: '' });
  });
}
