import type { DiscussionState } from '@/core';

/**
 * The story sheet's words: how long ago, how far, how many. Plain functions so
 * the copy is tested once and reads the same everywhere.
 */

const MINUTE_MS = 60_000;

/** "Just now", "12 min ago", "3 h ago": stories live 48 h, so hours are enough. */
export function formatAgo(timeMs: number, nowMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - timeMs) / MINUTE_MS);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

const DAY_MS = 86_400_000;

/** formatAgo, then "3 days ago": for notices and queued posts, which outlive a story. */
export function formatAgoLong(timeMs: number, nowMs: number): string {
  const days = Math.floor(Math.max(0, nowMs - timeMs) / DAY_MS);
  return days < 2 ? formatAgo(timeMs, nowMs) : `${days} days ago`;
}

/** "Under 1 km", "340 km", "1,200 km". */
export function formatKm(km: number): string {
  if (km < 1) return 'Under 1 km';
  return `${Math.round(km).toLocaleString('en-US')} km`;
}

export function sourcesText(count: number): string {
  return `Covered by ${count.toLocaleString('en-US')} ${count === 1 ? 'source' : 'sources'}`;
}

export interface DiscussCopy {
  readonly enabled: boolean;
  /** The button's text. */
  readonly label: string;
}

/**
 * The Discuss button is never hidden: open, it says how many are taking part
 * once that is known; otherwise it stays, greyed, saying why. A discussion is
 * live, so offline it waits for the connection (Prompt 5.2).
 */
export function discussCopy(
  state: DiscussionState,
  participants: number | null,
  online = true,
): DiscussCopy {
  if ((state === 'open' || state === 'closed') && !online) {
    return { enabled: false, label: 'Discussion needs a connection' };
  }
  if (state === 'open') {
    return {
      enabled: true,
      label:
        participants === null
          ? 'Discuss'
          : `Discuss · ${participants.toLocaleString('en-US')} taking part`,
    };
  }
  if (state === 'closed') return { enabled: true, label: 'Read the closed discussion' };
  return { enabled: false, label: 'Discussion not open yet' };
}
