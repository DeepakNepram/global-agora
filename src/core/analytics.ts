/**
 * Analytics (Prompt 5.2): exactly six measures, nothing personal.
 *
 * The app sends each event to our API Worker (POST /api/event), which passes
 * it to Umami without the reader's IP address, so Umami stores no location
 * either. No identifier of any kind is sent: no account, no device id, no
 * story id. Week-two return is counted without one too: the device keeps only
 * the ISO week of its first visit, and says once a week which week of its
 * life this is.
 *
 * Shared by the app and the Worker, which accepts these events and nothing
 * else (parseAnalyticsEvent).
 */

/** The six measures, as Umami's event names. */
export const ANALYTICS_EVENTS = [
  'session_end',
  'story_opened',
  'scrubber_used',
  'discussion_entered',
  'post_made',
  'week_active',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/** How long the app was on screen, in buckets: an exact time says more than it needs to. */
export const DURATION_BUCKETS = ['<30s', '30s-2m', '2-5m', '5-15m', '15-30m', '30m+'] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

export type AnalyticsEvent =
  | { readonly name: 'story_opened' | 'scrubber_used' | 'discussion_entered' | 'post_made' }
  /** A session ended: the app left the screen after this long on it. */
  | { readonly name: 'session_end'; readonly data: { readonly duration: DurationBucket } }
  /** First visit this calendar week: `week` weeks after the device's first, in `cohort`. */
  | {
      readonly name: 'week_active';
      readonly data: { readonly cohort: string; readonly week: number };
    };

/** Device storage: "off" when the reader turned counting off on the privacy page. */
export const ANALYTICS_OPT_OUT_KEY = 'agora.analytics.v1';
/** Device storage: the week of the first visit, and the last week counted. */
export const COHORT_KEY = 'agora.cohort.v1';
/** The window event the discussion panel dispatches when a post went in. */
export const POST_MADE_EVENT = 'agora:post-made';

const MINUTE_MS = 60_000;
/** Longer than any version of a week-number a cohort can reach in the app's life. */
const MAX_WEEKS = 520;
const WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;

export function durationBucket(ms: number): DurationBucket {
  if (ms < 0.5 * MINUTE_MS) return '<30s';
  if (ms < 2 * MINUTE_MS) return '30s-2m';
  if (ms < 5 * MINUTE_MS) return '2-5m';
  if (ms < 15 * MINUTE_MS) return '5-15m';
  if (ms < 30 * MINUTE_MS) return '15-30m';
  return '30m+';
}

/** The Monday (UTC, 00:00) of the ISO week that holds `ms`. */
function mondayOf(ms: number): number {
  const day = new Date(ms);
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const weekday = (day.getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return midnight - weekday * 86_400_000;
}

/** "2026-W44": the ISO 8601 week of `ms`, in UTC. */
export function isoWeek(ms: number): string {
  // The ISO year is the year of the week's Thursday.
  const thursday = new Date(mondayOf(ms) + 3 * 86_400_000);
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const week =
    1 +
    Math.round(
      (mondayOf(thursday.getTime()) - mondayOf(firstThursday.getTime())) / (7 * 86_400_000),
    );
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The Monday of an ISO week, or null for a malformed one. */
function weekStart(week: string): number | null {
  const match = WEEK_PATTERN.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const number = Number(match[2]);
  if (number < 1 || number > 53) return null;
  return mondayOf(Date.UTC(year, 0, 4)) + (number - 1) * 7 * 86_400_000;
}

/** Whole weeks from one ISO week to another; null if either is malformed. */
export function weeksBetween(from: string, to: string): number | null {
  const start = weekStart(from);
  const end = weekStart(to);
  if (start === null || end === null) return null;
  return Math.round((end - start) / (7 * 86_400_000));
}

export interface CohortRecord {
  /** The ISO week of the device's first visit. */
  readonly cohort: string;
  /** The last ISO week a week_active was sent for. */
  readonly counted: string;
}

/** Reads the stored record; anything malformed counts as none (a first visit). */
export function parseCohort(raw: unknown): CohortRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { cohort, counted } = raw as Record<string, unknown>;
  return typeof cohort === 'string' &&
    typeof counted === 'string' &&
    WEEK_PATTERN.test(cohort) &&
    WEEK_PATTERN.test(counted)
    ? { cohort, counted }
    : null;
}

/**
 * At the start of a session: whether this week is still to be counted, and
 * what to keep. Week 0 is the week of the first visit; a device seen in week
 * 1 returned in its second week.
 */
export function weekActive(
  stored: CohortRecord | null,
  nowMs: number,
): { readonly event: AnalyticsEvent | null; readonly store: CohortRecord } {
  const now = isoWeek(nowMs);
  const cohort = stored?.cohort ?? now;
  if (stored !== null && stored.counted === now) return { event: null, store: stored };
  const week = Math.max(0, weeksBetween(cohort, now) ?? 0);
  return {
    event: { name: 'week_active', data: { cohort, week } },
    store: { cohort, counted: now },
  };
}

/** The browser asks not to be tracked, or the reader turned counting off. */
export function analyticsAllowed(signals: {
  readonly globalPrivacyControl: boolean;
  readonly doNotTrack: boolean;
  readonly optedOut: boolean;
}): boolean {
  return !signals.globalPrivacyControl && !signals.doNotTrack && !signals.optedOut;
}

/** An event as the Worker receives it: one of the six, in its exact shape, or null. */
export function parseAnalyticsEvent(value: unknown): AnalyticsEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { name, data, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (
    name === 'story_opened' ||
    name === 'scrubber_used' ||
    name === 'discussion_entered' ||
    name === 'post_made'
  ) {
    return data === undefined ? { name } : null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const fields = data as Record<string, unknown>;
  if (name === 'session_end') {
    const { duration } = fields;
    return Object.keys(fields).length === 1 && DURATION_BUCKETS.includes(duration as DurationBucket)
      ? { name, data: { duration: duration as DurationBucket } }
      : null;
  }
  if (name === 'week_active') {
    const { cohort, week } = fields;
    return Object.keys(fields).length === 2 &&
      typeof cohort === 'string' &&
      WEEK_PATTERN.test(cohort) &&
      Number.isInteger(week) &&
      (week as number) >= 0 &&
      (week as number) <= MAX_WEEKS
      ? { name, data: { cohort, week: week as number } }
      : null;
  }
  return null;
}
