/**
 * The admin console over Supabase (Prompt 4.6): the admin_* functions,
 * open_discussion(), fix_story_location() and the suggest-debate Edge
 * Function. Errors become AdminErrors with a code the page can explain.
 */

// Explicit .ts: scripts/db/smoke.ts loads this under plain Node, which needs it.
import {
  AdminError,
  type AdminConsoleRemote,
  type AdminCounters,
  type AdminErrorCode,
  type HotStory,
  type LocationItem,
  type SuggestionReason,
  type SuggestionResult,
} from '../admin.ts';
import type { DbClient } from './client';

interface ServerError {
  readonly message: string;
  readonly code?: string | undefined;
  readonly details?: string | null | undefined;
}

export function adminErrorCode(error: ServerError): AdminErrorCode {
  const code = error.code ?? '';
  if (code === '42501') return 'not-admin';
  if (code === 'PGRST301' || code === 'PGRST303') return 'signed-out';
  if (code === 'PT409') return 'cap';
  if (code === '55000') return 'not-queued';
  if (code === 'P0002') return 'missing';
  if (code === '22023' || code === '23514') return 'invalid';
  if (/failed to fetch|network/i.test(error.message)) return 'network';
  return 'unknown';
}

function fail(action: string, error: ServerError | null): void {
  if (!error) return;
  const code = adminErrorCode(error);
  // The cap's detail is when the next discussion closes (open_discussion()).
  const nextClose = code === 'cap' && error.details ? Date.parse(error.details) : Number.NaN;
  throw new AdminError(
    code,
    `${action}: ${error.message}`,
    Number.isFinite(nextClose) ? nextClose : null,
  );
}

const ms = (iso: string | null | undefined): number | null => {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(value) ? value : null;
};

// The generated types cannot know which columns may be null.
interface StoryRow {
  readonly story_id: string;
  readonly seq: number;
  readonly title: string;
  readonly summary: string | null;
  readonly place_name: string | null;
  readonly country_code: string | null;
  readonly heat: number;
  readonly source_count: number;
  readonly published_at: string;
  readonly location_reports: number;
}

export function toHotStory(row: StoryRow): HotStory {
  return {
    storyId: row.story_id,
    seq: row.seq,
    title: row.title,
    summary: row.summary,
    placeName: row.place_name,
    countryCode: row.country_code,
    heat: row.heat,
    sourceCount: row.source_count,
    publishedAtMs: Date.parse(row.published_at),
    locationReports: row.location_reports,
  };
}

interface CountersRow {
  readonly open_discussions: number;
  readonly max_open: number;
  readonly next_close_at: string | null;
  readonly posts_today: number;
  readonly reports_open: number;
  readonly median_action_seconds: number | null;
  readonly reports_resolved: number;
  readonly median_window_days: number;
}

export function toCounters(row: CountersRow): AdminCounters {
  return {
    openDiscussions: row.open_discussions,
    maxOpen: row.max_open,
    nextCloseAtMs: ms(row.next_close_at),
    postsToday: row.posts_today,
    reportsOpen: row.reports_open,
    medianActionSeconds: row.median_action_seconds,
    reportsResolved: row.reports_resolved,
    medianWindowDays: row.median_window_days,
  };
}

interface LocationRow {
  readonly story_id: string;
  readonly seq: number;
  readonly title: string;
  readonly place_name: string | null;
  readonly country_code: string | null;
  readonly place_source: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly published_at: string;
  readonly reports: number;
  readonly last_reported_at: string | null;
}

export function toLocationItem(row: LocationRow): LocationItem {
  return {
    storyId: row.story_id,
    seq: row.seq,
    title: row.title,
    placeName: row.place_name,
    countryCode: row.country_code,
    placeSource: row.place_source,
    lat: row.lat,
    lon: row.lon,
    publishedAtMs: Date.parse(row.published_at),
    reports: row.reports,
    lastReportedAtMs: ms(row.last_reported_at),
  };
}

const REASONS: readonly SuggestionReason[] = [
  'not-configured',
  'declined',
  'unusable',
  'unavailable',
];

/** The suggest-debate function's reply, read defensively. */
export function toSuggestion(data: unknown): SuggestionResult {
  const body = (typeof data === 'object' && data !== null ? data : {}) as {
    suggestion?: { prompt?: unknown; side_a?: unknown; side_b?: unknown } | null;
    reason?: unknown;
  };
  const words = body.suggestion;
  if (
    words &&
    typeof words.prompt === 'string' &&
    typeof words.side_a === 'string' &&
    typeof words.side_b === 'string'
  ) {
    return {
      kind: 'ok',
      draft: { prompt: words.prompt, sideA: words.side_a, sideB: words.side_b },
    };
  }
  const reason = REASONS.find((known) => known === body.reason) ?? 'unavailable';
  return { kind: 'none', reason };
}

/** The HTTP status of a functions.invoke() error, when it has one. */
function statusOf(error: unknown): number | null {
  const context = (error as { context?: unknown } | null)?.context;
  return context instanceof Response ? context.status : null;
}

export function createAdminConsoleRemote(client: DbClient): AdminConsoleRemote {
  return {
    async storyQueue(limit) {
      const { data, error } = await client.rpc('admin_story_queue', { p_limit: limit });
      fail('read the story queue', error);
      return ((data ?? []) as readonly StoryRow[]).map(toHotStory);
    },

    async counters(dayStartMs) {
      const { data, error } = await client.rpc('admin_counters', {
        p_day_start: new Date(dayStartMs).toISOString(),
      });
      fail('read the counters', error);
      const row = (data as readonly CountersRow[] | null)?.[0];
      if (row === undefined) throw new AdminError('unknown', 'read the counters: no row');
      return toCounters(row);
    },

    async suggest(storyId) {
      const { data, error } = await client.functions.invoke('suggest-debate', {
        body: { story_id: storyId },
      });
      if (!error) return toSuggestion(data);
      const status = statusOf(error);
      if (status === 401) throw new AdminError('signed-out', 'suggest: sign in again');
      if (status === 403) throw new AdminError('not-admin', 'suggest: moderators only');
      if (status === 404) throw new AdminError('missing', 'suggest: no such story');
      // Anything else (the function down, a 5xx): the admin types the words.
      return { kind: 'none', reason: 'unavailable' };
    },

    async openDiscussion(storyId, draft) {
      const { data, error } = await client.rpc('open_discussion', {
        p_story: storyId,
        p_prompt: draft.prompt,
        p_side_a: draft.sideA,
        p_side_b: draft.sideB,
      });
      fail('open the discussion', error);
      const row = data?.[0];
      if (row === undefined) throw new AdminError('unknown', 'open the discussion: no row');
      return {
        storyId: row.story_id,
        closesAtMs: Date.parse(row.closes_at),
        openCount: row.open_count,
        maxOpen: row.max_open,
      };
    },

    async locationQueue(limit, seq) {
      const { data, error } = await client.rpc('admin_location_queue', {
        p_limit: limit,
        ...(seq === undefined ? {} : { p_seq: seq }),
      });
      fail('read the location queue', error);
      return ((data ?? []) as readonly LocationRow[]).map(toLocationItem);
    },

    async fixLocation(storyId, fix) {
      const { data, error } = await client.rpc('fix_story_location', {
        p_story: storyId,
        p_lat: fix.lat,
        p_lon: fix.lon,
        // The function reads '' as none.
        p_place_name: fix.placeName ?? '',
        p_country_code: fix.countryCode ?? '',
      });
      fail('move the pin', error);
      return data ?? 0;
    },
  };
}
