import { categoryAt, CATEGORY_LABELS, type NodeBuffer } from '@/core';
import type { PinTarget } from '@/globe';

import { plural } from '../nav/searchOptions';

const MINUTE_MS = 60_000;

/** "just now", "12 minutes ago", "3 hours ago": spoken, so no "min" or "h". */
export function spokenAgo(timeMs: number, nowMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - timeMs) / MINUTE_MS);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${plural(minutes, 'minute', 'minutes')} ago`;
  return `${plural(Math.floor(minutes / 60), 'hour', 'hours')} ago`;
}

/**
 * What a screen reader hears as Tab lands on a pin (Prompt 5.1): a story's
 * headline, category, place and age; an orb's size, main category and
 * place, and what Enter does; then where it is in the round.
 */
export function describePinTarget(
  target: PinTarget,
  nodes: NodeBuffer,
  nowMs: number,
  position: { readonly index: number; readonly total: number },
): string {
  const category = CATEGORY_LABELS[categoryAt(target.category)];
  const place = nodes.places[target.row] ?? '';
  const of = `${position.index + 1} of ${position.total}.`;
  if (target.kind === 'cluster') {
    const near = place === '' ? '' : `, near ${place}`;
    return `${plural(target.count, 'story', 'stories')}, mostly ${category}${near}. Enter zooms in. ${of}`;
  }
  const publishedMs = (nodes.epochSec + (nodes.publishedSec[target.row] ?? 0)) * 1000;
  const parts = [category, place, spokenAgo(publishedMs, nowMs)].filter((part) => part !== '');
  return `${nodes.headlines[target.row] ?? ''}. ${parts.join(', ')}. ${of}`;
}
