/**
 * The admin console (Prompt 4.6): the hot story queue, opening a discussion
 * under the cap, the counters, and correcting a story's location. Every call
 * goes through a database function that refuses anyone who is not an admin
 * (supabase/migrations/20261022100000_admin_console.sql).
 *
 * No value imports: db:smoke loads this under plain Node, which needs
 * explicit extensions all the way down.
 */

/** A debate's words fit the discussion panel's header (the discussions CHECKs). */
export const PROMPT_MAX_CHARS = 200;
export const SIDE_MAX_CHARS = 40;

/** How many queued stories and reported locations the page loads at once. */
export const ADMIN_PAGE = 100;

export interface HotStory {
  readonly storyId: string;
  /** The payload's id, for a link to the story on the globe. */
  readonly seq: number;
  readonly title: string;
  readonly summary: string | null;
  readonly placeName: string | null;
  readonly countryCode: string | null;
  readonly heat: number;
  readonly sourceCount: number;
  readonly publishedAtMs: number;
  /** Readers who said the pin is in the wrong place. */
  readonly locationReports: number;
}

export interface AdminCounters {
  readonly openDiscussions: number;
  readonly maxOpen: number;
  readonly nextCloseAtMs: number | null;
  /** Since the admin's local midnight, in any moderation state. */
  readonly postsToday: number;
  readonly reportsOpen: number;
  /** Median from report to decision; null with none resolved in the window. */
  readonly medianActionSeconds: number | null;
  readonly reportsResolved: number;
  readonly medianWindowDays: number;
}

export interface DebateDraft {
  readonly prompt: string;
  readonly sideA: string;
  readonly sideB: string;
}

/** Why the suggestion function gave no words (the admin types them). */
export type SuggestionReason = 'not-configured' | 'declined' | 'unusable' | 'unavailable';

export type SuggestionResult =
  | { readonly kind: 'ok'; readonly draft: DebateDraft }
  | { readonly kind: 'none'; readonly reason: SuggestionReason };

export interface OpenedDiscussion {
  readonly storyId: string;
  readonly closesAtMs: number;
  readonly openCount: number;
  readonly maxOpen: number;
}

export interface LocationItem {
  readonly storyId: string;
  readonly seq: number;
  readonly title: string;
  readonly placeName: string | null;
  readonly countryCode: string | null;
  /** 'gdelt', 'dateline' or 'manual' (an admin moved it). */
  readonly placeSource: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly publishedAtMs: number;
  readonly reports: number;
  readonly lastReportedAtMs: number | null;
}

export interface LocationFix {
  readonly lat: number;
  readonly lon: number;
  readonly placeName: string | null;
  readonly countryCode: string | null;
}

export type AdminErrorCode =
  | 'signed-out'
  | 'not-admin'
  /** The cap: as many discussions are open as may be. */
  | 'cap'
  /** The story is not (or no longer) in the queue. */
  | 'not-queued'
  | 'missing'
  /** The database refused the words or the coordinates. */
  | 'invalid'
  | 'network'
  | 'unknown';

export class AdminError extends Error {
  override readonly name: string = 'AdminError';
  readonly code: AdminErrorCode;
  /** For 'cap': when the next open discussion closes. */
  readonly nextCloseAtMs: number | null;
  constructor(code: AdminErrorCode, message: string, nextCloseAtMs: number | null = null) {
    super(message);
    this.code = code;
    this.nextCloseAtMs = nextCloseAtMs;
  }
}

export interface AdminConsoleRemote {
  storyQueue(limit: number): Promise<HotStory[]>;
  counters(dayStartMs: number): Promise<AdminCounters>;
  suggest(storyId: string): Promise<SuggestionResult>;
  openDiscussion(storyId: string, draft: DebateDraft): Promise<OpenedDiscussion>;
  /** Reported stories, most reported first; with `seq`, that one story. */
  locationQueue(limit: number, seq?: number): Promise<LocationItem[]>;
  /** Moves the pin; returns how many readers' reports that answered. */
  fixLocation(storyId: string, fix: LocationFix): Promise<number>;
}

/** Characters as Postgres counts them (code points), not UTF-16 units. */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/** One line, single-spaced, trimmed: what the database stores. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export type DraftProblem =
  'prompt-empty' | 'prompt-long' | 'side-empty' | 'side-long' | 'same-sides';

/** What stops the draft opening, in the order the form shows it; null when it can open. */
export function draftProblem(draft: DebateDraft): DraftProblem | null {
  const prompt = oneLine(draft.prompt);
  const sideA = oneLine(draft.sideA);
  const sideB = oneLine(draft.sideB);
  if (prompt === '') return 'prompt-empty';
  if (charCount(prompt) > PROMPT_MAX_CHARS) return 'prompt-long';
  if (sideA === '' || sideB === '') return 'side-empty';
  if (charCount(sideA) > SIDE_MAX_CHARS || charCount(sideB) > SIDE_MAX_CHARS) return 'side-long';
  if (sideA.toLowerCase() === sideB.toLowerCase()) return 'same-sides';
  return null;
}

export function cleanDraft(draft: DebateDraft): DebateDraft {
  return {
    prompt: oneLine(draft.prompt),
    sideA: oneLine(draft.sideA),
    sideB: oneLine(draft.sideB),
  };
}

/** Local midnight before `nowMs`, in the runtime's time zone: where "posts today" starts. */
export function localMidnight(nowMs: number): number {
  const day = new Date(nowMs);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * The story number in a pasted permalink (`?story=123`, PERMALINK_PARAMS in
 * permalink.ts; a test keeps the two in step) or a bare number.
 */
export function storySeqFrom(text: string): number | null {
  const trimmed = text.trim();
  const fromLink = /[?&]story=(\d+)/.exec(trimmed)?.[1];
  const raw = fromLink ?? (/^\d+$/.test(trimmed) ? trimmed : null);
  if (raw === null) return null;
  const seq = Number(raw);
  return Number.isSafeInteger(seq) && seq > 0 ? seq : null;
}
