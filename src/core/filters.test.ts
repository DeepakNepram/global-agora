import { describe, expect, it } from 'vitest';

import {
  categoryMask,
  decodeFilters,
  isFilterActive,
  matchesFilter,
  normalizeCategories,
  sameFilter,
  toggleCategory,
  windowChoices,
  withFilters,
  NO_FILTER,
  type StoryFilter,
} from './filters';
import { createNodeBuffer, NEWS_CATEGORIES } from './nodeBuffer';

describe('windowChoices', () => {
  it('offers the windows shorter than the history', () => {
    expect(windowChoices(24)).toEqual([1, 3, 6, 12]);
  });

  it('grows with a deeper history, so a tier needs no code change', () => {
    expect(windowChoices(168)).toEqual([1, 3, 6, 12, 24, 48, 72]);
    expect(windowChoices(1)).toEqual([]);
  });
});

describe('normalizeCategories', () => {
  it('keeps known names in canonical order, once each', () => {
    expect(normalizeCategories(['tech', 'climate', 'tech', 'nope'])).toEqual(['climate', 'tech']);
  });

  it('treats every category as no filter', () => {
    expect(normalizeCategories([...NEWS_CATEGORIES].reverse())).toEqual([]);
  });
});

describe('categoryMask', () => {
  it('sets every bit with no category picked', () => {
    expect(categoryMask(NO_FILTER)).toBe(0xff);
  });

  it('sets the bits of the picked categories', () => {
    expect(categoryMask({ categories: ['world', 'climate'], withinHours: null })).toBe(
      (1 << 0) | (1 << 5),
    );
  });
});

describe('toggleCategory', () => {
  it('adds and removes a category', () => {
    const on = toggleCategory(NO_FILTER, 'tech');
    expect(on.categories).toEqual(['tech']);
    expect(toggleCategory(on, 'tech').categories).toEqual([]);
  });

  it('collapses back to all when the last one is added', () => {
    let filter: StoryFilter = NO_FILTER;
    for (const name of NEWS_CATEGORIES) filter = toggleCategory(filter, name);
    expect(filter.categories).toEqual([]);
  });
});

describe('isFilterActive and sameFilter', () => {
  it('knows the default', () => {
    expect(isFilterActive(NO_FILTER)).toBe(false);
    expect(isFilterActive({ categories: [], withinHours: 6 })).toBe(true);
    expect(sameFilter(NO_FILTER, { categories: [], withinHours: null })).toBe(true);
    expect(sameFilter(NO_FILTER, { categories: ['tech'], withinHours: null })).toBe(false);
  });
});

describe('matchesFilter', () => {
  const nodes = createNodeBuffer(2);
  nodes.count = 2;
  nodes.epochSec = 1_000_000;
  nodes.categories[0] = 5; // climate
  nodes.publishedSec[0] = 0;
  nodes.categories[1] = 6; // tech
  nodes.publishedSec[1] = 20_000;
  const now = 1_000_000 + 21_600; // 6 h after the window start

  it('matches by category', () => {
    const climate: StoryFilter = { categories: ['climate'], withinHours: null };
    expect(matchesFilter(nodes, 0, now, climate)).toBe(true);
    expect(matchesFilter(nodes, 1, now, climate)).toBe(false);
  });

  it('measures the window back from the displayed instant', () => {
    const hour: StoryFilter = { categories: [], withinHours: 1 };
    expect(matchesFilter(nodes, 0, now, hour)).toBe(false);
    expect(matchesFilter(nodes, 1, now, hour)).toBe(true);
    // Scrubbed back to just after the first story: it is the recent one now.
    expect(matchesFilter(nodes, 0, 1_000_000 + 60, hour)).toBe(true);
  });

  it('does not match a story published after the instant', () => {
    expect(matchesFilter(nodes, 1, 1_000_000 + 60, { categories: [], withinHours: 1 })).toBe(false);
  });

  it('includes the edge of the window', () => {
    expect(matchesFilter(nodes, 0, now, { categories: [], withinHours: 6 })).toBe(true);
  });
});

describe('decodeFilters', () => {
  it('reads both fields', () => {
    expect(decodeFilters('?cats=tech,climate&within=6', 24)).toEqual({
      categories: ['climate', 'tech'],
      withinHours: 6,
    });
  });

  it('drops what it does not know, field by field', () => {
    expect(decodeFilters('?cats=tech,gossip&within=5', 24)).toEqual({
      categories: ['tech'],
      withinHours: null,
    });
    expect(decodeFilters('within=-1&cats=', 24)).toEqual(NO_FILTER);
    expect(decodeFilters('within=1e3', 24)).toEqual(NO_FILTER);
  });

  it('refuses a window the history cannot cover', () => {
    expect(decodeFilters('within=48', 24).withinHours).toBeNull();
    expect(decodeFilters('within=48', 168).withinHours).toBe(48);
  });

  it('is empty without the fields', () => {
    expect(decodeFilters('', 24)).toEqual(NO_FILTER);
  });
});

describe('withFilters', () => {
  it('writes legible fields after the others', () => {
    expect(withFilters('?story=12', { categories: ['climate', 'tech'], withinHours: 6 })).toBe(
      '?story=12&cats=climate,tech&within=6',
    );
  });

  it('removes the fields for the default', () => {
    expect(withFilters('?cats=tech&within=6&x=1', NO_FILTER)).toBe('?x=1');
    expect(withFilters('?cats=tech', NO_FILTER)).toBe('');
  });

  it('keeps the other fields exactly as written', () => {
    expect(
      withFilters('?story=5&cam=51.5,-0.1,833&t=20261001T120000Z', {
        categories: ['climate'],
        withinHours: 6,
      }),
    ).toBe('?story=5&cam=51.5,-0.1,833&t=20261001T120000Z&cats=climate&within=6');
  });

  it('round-trips', () => {
    const filter: StoryFilter = { categories: ['world', 'health'], withinHours: 3 };
    expect(decodeFilters(withFilters('', filter), 24)).toEqual(filter);
  });
});
