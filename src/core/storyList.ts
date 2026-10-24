/**
 * The list view's stories (Prompt 5.1): the same stories the globe draws at
 * the displayed instant, as rows to read. A story published after that
 * instant is not on the globe, so it is not here either; the filters apply,
 * and the stories they leave out are counted, not hidden without a word.
 */

import { categoryMask, matchesFilter, type StoryFilter } from './filters';
import type { NodeBuffer } from './nodeBuffer';

export type StorySort = 'newest' | 'covered';

/** Rows shown before "Show more": a page, never an infinite scroll (CLAUDE.md). */
export const LIST_PAGE_SIZE = 50;

export interface StoryListResult {
  /** Node rows to show, in order. */
  readonly rows: readonly number[];
  /** Published by the displayed instant, before the filters. */
  readonly published: number;
}

function publishedAt(nodes: NodeBuffer, row: number): number {
  return nodes.epochSec + (nodes.publishedSec[row] ?? 0);
}

/**
 * The stories at `nowSec` (epoch seconds) that `filter` keeps, sorted:
 * newest first, or the most covered (heat, then outlets) first. Ties fall to
 * the newer story, then the higher id, so the order never shuffles.
 */
export function listStories(
  nodes: NodeBuffer,
  nowSec: number,
  filter: StoryFilter,
  sort: StorySort,
): StoryListResult {
  const mask = categoryMask(filter);
  const rows: number[] = [];
  let published = 0;
  for (let row = 0; row < nodes.count; row++) {
    if (publishedAt(nodes, row) > nowSec) continue;
    published++;
    if (matchesFilter(nodes, row, nowSec, filter, mask)) rows.push(row);
  }
  const newer = (a: number, b: number): number =>
    publishedAt(nodes, b) - publishedAt(nodes, a) || (nodes.ids[b] ?? 0) - (nodes.ids[a] ?? 0);
  rows.sort(
    sort === 'newest'
      ? newer
      : (a, b) =>
          (nodes.heat[b] ?? 0) - (nodes.heat[a] ?? 0) ||
          (nodes.sourceCounts[b] ?? 0) - (nodes.sourceCounts[a] ?? 0) ||
          newer(a, b),
  );
  return { rows, published };
}

/**
 * What decides the list's contents at `nowSec`, as one string: the number
 * of stories published by then and, under a time window, the number that
 * have aged out of it. The list recomputes only when this changes, not on
 * every frame of Play.
 */
export function listKey(nodes: NodeBuffer | null, nowSec: number, filter: StoryFilter): string {
  if (!nodes) return '';
  const oldest = filter.withinHours === null ? -Infinity : nowSec - filter.withinHours * 3600;
  let published = 0;
  let aged = 0;
  for (let row = 0; row < nodes.count; row++) {
    const at = publishedAt(nodes, row);
    if (at > nowSec) continue;
    published++;
    if (at < oldest) aged++;
  }
  return `${published}:${aged}`;
}
