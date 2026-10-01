/**
 * The globe's filters: which categories, and how recent. A story that does
 * not match is dimmed and shrunk, never hidden, so the globe never goes dark.
 *
 *   /?cats=climate,tech&within=6
 *
 * - `cats`: category names, comma separated. None (or every one) means all.
 * - `within`: hours back from the displayed instant (the scrubber's time, not
 *   the wall clock), one of windowChoices() for the history depth. None means
 *   any time.
 *
 * The filters live in the address bar for as long as they apply, unlike a
 * permalink's view, which is cleared once opened. Each field decodes on its
 * own, and a value it does not know is dropped, not an error.
 */

import { NEWS_CATEGORIES, type NewsCategory, type NodeBuffer } from './nodeBuffer';

export interface StoryFilter {
  /** In NEWS_CATEGORIES order, no repeats; empty means every category. */
  readonly categories: readonly NewsCategory[];
  /** Hours back from the displayed instant, or null for any time. */
  readonly withinHours: number | null;
}

export const NO_FILTER: StoryFilter = { categories: [], withinHours: null };

export const FILTER_PARAMS = { categories: 'cats', within: 'within' } as const;

/**
 * Candidate windows. Those shorter than the history depth are offered, so a
 * tier with a deeper history (a paid boundary, AppConfig) gets longer ones
 * without a change here.
 */
const WINDOW_LADDER_HOURS = [1, 3, 6, 12, 24, 48, 72, 168] as const;

/** The time windows offered for a history `historyHours` deep, shortest first. */
export function windowChoices(historyHours: number): number[] {
  return WINDOW_LADDER_HOURS.filter((hours) => hours < historyHours);
}

const CATEGORY_INDEX: ReadonlyMap<string, number> = new Map(
  NEWS_CATEGORIES.map((name, index) => [name, index]),
);

/** Categories in canonical order without repeats; every one of them collapses to "all". */
export function normalizeCategories(names: readonly string[]): NewsCategory[] {
  const picked = new Set(names);
  const kept = NEWS_CATEGORIES.filter((name) => picked.has(name));
  return kept.length === NEWS_CATEGORIES.length ? [] : kept;
}

export function isFilterActive(filter: StoryFilter): boolean {
  return filter.categories.length > 0 || filter.withinHours !== null;
}

export function sameFilter(a: StoryFilter, b: StoryFilter): boolean {
  return (
    a.withinHours === b.withinHours &&
    a.categories.length === b.categories.length &&
    a.categories.every((name, i) => b.categories[i] === name)
  );
}

/** One bit per NEWS_CATEGORIES index; every bit set when no category is picked. */
export function categoryMask(filter: StoryFilter): number {
  if (filter.categories.length === 0) return (1 << NEWS_CATEGORIES.length) - 1;
  let mask = 0;
  for (const name of filter.categories) mask |= 1 << (CATEGORY_INDEX.get(name) ?? 0);
  return mask;
}

/** The filter with `category` switched on or off. */
export function toggleCategory(filter: StoryFilter, category: NewsCategory): StoryFilter {
  const on = filter.categories.includes(category);
  const next = on
    ? filter.categories.filter((name) => name !== category)
    : [...filter.categories, category];
  return { ...filter, categories: normalizeCategories(next) };
}

/**
 * Whether row `row` matches at the displayed instant `nowSec` (epoch s): its
 * category is picked, and with a window, it was published no more than
 * `withinHours` before that instant (and not after it).
 */
export function matchesFilter(
  nodes: NodeBuffer,
  row: number,
  nowSec: number,
  filter: StoryFilter,
  mask: number = categoryMask(filter),
): boolean {
  if (((mask >> (nodes.categories[row] ?? 0)) & 1) === 0) return false;
  if (filter.withinHours === null) return true;
  const age = nowSec - (nodes.epochSec + (nodes.publishedSec[row] ?? 0));
  return age >= 0 && age <= filter.withinHours * 3600;
}

/** Reads a query string (with or without its "?"); `historyHours` bounds the window. */
export function decodeFilters(search: string, historyHours: number): StoryFilter {
  const params = new URLSearchParams(search);
  const cats = params.get(FILTER_PARAMS.categories);
  const within = params.get(FILTER_PARAMS.within);
  const hours = within !== null && /^[1-9]\d{0,3}$/.test(within) ? Number(within) : null;
  return {
    categories: cats === null ? [] : normalizeCategories(cats.split(',')),
    withinHours: hours !== null && windowChoices(historyHours).includes(hours) ? hours : null,
  };
}

/**
 * `search` with the filter's fields set (or removed when they are the
 * default) and every other field kept, "" when nothing is left.
 */
export function withFilters(search: string, filter: StoryFilter): string {
  const params = new URLSearchParams(search);
  params.delete(FILTER_PARAMS.categories);
  params.delete(FILTER_PARAMS.within);
  // Written by hand: URLSearchParams would escape the commas.
  const parts = params.toString() === '' ? [] : [params.toString()];
  if (filter.categories.length > 0) {
    parts.push(`${FILTER_PARAMS.categories}=${filter.categories.join(',')}`);
  }
  if (filter.withinHours !== null) parts.push(`${FILTER_PARAMS.within}=${filter.withinHours}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}
