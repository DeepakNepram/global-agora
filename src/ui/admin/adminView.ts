import type { AdminCounters, DraftProblem } from '@/core/admin';
import type { ConsoleMessage, SuggestionNote } from '@/state/adminConsoleStore';
import type { LocationMessage } from '@/state/adminLocations';

/**
 * The admin console's words (Prompt 4.6): plain functions, so the copy is
 * tested once and reads the same in every tab.
 */

export type AdminTab = 'stories' | 'moderation' | 'locations';

export const ADMIN_TABS: readonly {
  readonly id: AdminTab;
  readonly label: string;
  readonly path: string;
}[] = [
  { id: 'stories', label: 'Hot stories', path: '/admin' },
  { id: 'moderation', label: 'Moderation', path: '/admin/moderation' },
  { id: 'locations', label: 'Locations', path: '/admin/locations' },
];

export const tabId = (tab: AdminTab): string => `admin-tab-${tab}`;
export const panelId = (tab: AdminTab): string => `admin-panel-${tab}`;

/** The tab a path shows; anything unknown under /admin is the hot stories. */
export function tabForPath(path: string): AdminTab {
  const trimmed = path.replace(/\/+$/, '');
  return ADMIN_TABS.find((tab) => tab.path === trimmed)?.id ?? 'stories';
}

/** "45 s", "12 min", "1 h 20 min", "48 h", "3 days": how long something waited, or will. */
export function formatWait(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 72) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  return `${Math.round(seconds / 86_400)} days`;
}

/** "14:20" in the admin's own time zone. */
export function clockTime(timeMs: number): string {
  return new Date(timeMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** "in 3 h 10 min" (never "in 0 s": a time already past reads "any minute now"). */
export function inTime(timeMs: number, nowMs: number): string {
  const seconds = (timeMs - nowMs) / 1000;
  return seconds < 60 ? 'any minute now' : `in ${formatWait(seconds)}`;
}

export function atCap(counters: AdminCounters | null): boolean {
  return counters !== null && counters.openDiscussions >= counters.maxOpen;
}

/** The cap, said plainly: why nothing more opens, and when it can. */
export function capText(maxOpen: number, nextCloseAtMs: number | null, nowMs: number): string {
  const open = maxOpen === 1 ? '1 discussion is open' : `${maxOpen} discussions are open`;
  const limit = `${open}, the most at once, so moderation stays manageable.`;
  if (nextCloseAtMs === null) return limit;
  return `${limit} The next one closes at ${clockTime(nextCloseAtMs)}, ${inTime(nextCloseAtMs, nowMs)}.`;
}

export interface CounterCell {
  readonly label: string;
  readonly value: string;
  /** A second line, when the number needs one. */
  readonly detail: string | null;
}

export function counterCells(counters: AdminCounters): CounterCell[] {
  return [
    {
      label: 'Open discussions',
      value: `${counters.openDiscussions} of ${counters.maxOpen}`,
      detail:
        counters.nextCloseAtMs === null ? null : `Next closes ${clockTime(counters.nextCloseAtMs)}`,
    },
    {
      label: 'Posts today',
      value: counters.postsToday.toLocaleString('en-US'),
      detail: 'Since midnight',
    },
    { label: 'Reports open', value: counters.reportsOpen.toLocaleString('en-US'), detail: null },
    {
      label: 'Median time to act',
      value: formatWait(counters.medianActionSeconds),
      detail:
        counters.reportsResolved === 0
          ? `None resolved in ${counters.medianWindowDays} days`
          : `${counters.reportsResolved} reports, last ${counters.medianWindowDays} days`,
    },
  ];
}

/** The form's note on where its words came from. */
export function suggestionNoteText(note: SuggestionNote | null, suggesting: boolean): string {
  if (suggesting) return 'Asking Claude for a suggestion. You can start typing.';
  switch (note) {
    case 'suggested':
      return 'Suggested by Claude. Check it reads fairly to both sides, then edit or open.';
    case 'not-configured':
      return 'No suggestion: the Claude key is not set. Type the words.';
    case 'declined':
      return 'Claude declined to suggest for this story. Type the words.';
    case 'unusable':
      return 'The suggestion did not fit the limits. Type the words, or ask again.';
    case 'unavailable':
    case 'failed':
      return 'Claude did not answer. Type the words, or ask again.';
    case null:
      return '';
  }
}

export function draftProblemText(problem: DraftProblem | 'refused'): string {
  switch (problem) {
    case 'prompt-empty':
      return 'Write the debate question.';
    case 'prompt-long':
      return 'The question is too long: 200 characters at most.';
    case 'side-empty':
      return 'Name both sides.';
    case 'side-long':
      return 'A side is too long: 40 characters at most.';
    case 'same-sides':
      return 'The two sides need different names.';
    case 'refused':
      return 'The database refused these words. Check each fits on one line.';
  }
}

export function consoleMessageText(message: ConsoleMessage, nowMs: number): string {
  switch (message.kind) {
    case 'opened':
      return `Opened: “${message.title}”. It closes ${clockTime(message.closesAtMs)}, ${inTime(message.closesAtMs, nowMs)}.`;
    case 'cap':
      return capText(message.maxOpen, message.nextCloseAtMs, nowMs);
    case 'gone':
      return `“${message.title}” is no longer in the queue: someone opened it, or it aged out.`;
    case 'failed':
      return 'That did not go through. Check the connection and try again.';
  }
}

export function locationMessageText(message: LocationMessage): string {
  switch (message.kind) {
    case 'moved':
      return message.reports === 0
        ? `Moved “${message.title}”. The globe shows it within a few minutes.`
        : `Moved “${message.title}” and answered ${message.reports} report${message.reports === 1 ? '' : 's'}. The globe shows it within a few minutes.`;
    case 'not-found':
      return 'No story with that link. Paste a story’s share link, or its number.';
    case 'failed':
      return 'That did not go through. Check the connection and try again.';
  }
}

/** "48.8566° N, 2.3522° E": four places is about 11 m, plenty for a pin. */
export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}
