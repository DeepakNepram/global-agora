/**
 * News saved for offline reading (Prompt 5.2). The service worker
 * (src/sw/sw.ts) keeps the last good reply of each news request and, when
 * the network fails, answers with it, marked with SAVED_AT_HEADER. The app
 * reads the mark to say honestly that what it shows is old.
 */

import type { NodeBuffer } from '../nodeBuffer';

/**
 * Set only on a reply the service worker answered from its saved copy. Its
 * value is the saved reply's HTTP Date, or "unknown" when it had none.
 */
export const SAVED_AT_HEADER = 'x-agora-saved-at';

/**
 * When the saved copy was made, epoch ms (0 when unknown), or null when the
 * reply came from the network.
 */
export function savedAtFrom(headers: Pick<Headers, 'get'>): number | null {
  const raw = headers.get(SAVED_AT_HEADER);
  if (raw === null) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Epoch ms of the newest story; nodes arrive in time order, but take the max anyway. */
export function newestStoryMs(nodes: NodeBuffer): number | null {
  if (nodes.count === 0) return null;
  let newest = 0;
  for (let i = 0; i < nodes.count; i++) newest = Math.max(newest, nodes.publishedSec[i] ?? 0);
  return (nodes.epochSec + newest) * 1000;
}

/**
 * How old the news is, for "Showing news from 3 hours ago": the age of the
 * newest story shown. GDELT runs about an hour behind, so even fresh news
 * reads "an hour ago"; that is the truth, not a fault.
 */
export function newsAgeText(newestMs: number, nowMs: number): string {
  const ageMs = Math.max(0, nowMs - newestMs);
  const hours = Math.floor(ageMs / HOUR_MS);
  if (hours < 1) return 'less than an hour ago';
  if (hours < 2) return 'an hour ago';
  if (ageMs < 2 * DAY_MS) return `${hours} hours ago`;
  return `${Math.floor(ageMs / DAY_MS)} days ago`;
}
