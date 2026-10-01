import { describe, expect, it } from 'vitest';

import { NO_FILTER } from '@/core';

import { createFilterStore } from './filterStore';

describe('filterStore', () => {
  it('toggles categories and the window, and clears', () => {
    const store = createFilterStore();
    store.getState().toggleCategory('tech');
    store.getState().toggleCategory('climate');
    store.getState().setWithin(6);
    expect(store.getState().filter).toEqual({ categories: ['climate', 'tech'], withinHours: 6 });
    store.getState().onlyCategory('world');
    expect(store.getState().filter).toEqual({ categories: ['world'], withinHours: 6 });
    store.getState().clear();
    expect(store.getState().filter).toEqual(NO_FILTER);
  });

  it('keeps the same object when nothing changes, so subscribers stay quiet', () => {
    const store = createFilterStore();
    let changes = 0;
    store.subscribe(() => changes++);
    store.getState().clear();
    store.getState().setFilter({ categories: [], withinHours: null });
    expect(changes).toBe(0);
    store.getState().setFilter({ categories: ['tech', 'tech'], withinHours: null });
    expect(store.getState().filter.categories).toEqual(['tech']);
    expect(changes).toBe(1);
  });
});
