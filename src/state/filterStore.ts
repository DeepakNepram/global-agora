import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  normalizeCategories,
  sameFilter,
  toggleCategory,
  NO_FILTER,
  type NewsCategory,
  type StoryFilter,
} from '@/core';

/**
 * The globe's filters (src/core/filters.ts): which categories, and how
 * recent. The pin layer dims what they leave out; the address bar carries
 * them (ui/nav/useFilterUrl.ts), so a reload or a shared link keeps them.
 */

export interface FilterState {
  readonly filter: StoryFilter;
  setFilter(filter: StoryFilter): void;
  toggleCategory(category: NewsCategory): void;
  /** Just this category: a topic chosen in search. */
  onlyCategory(category: NewsCategory): void;
  setWithin(hours: number | null): void;
  clear(): void;
}

export type FilterStore = StoreApi<FilterState>;

export function createFilterStore(): FilterStore {
  return createStore<FilterState>()((set, get) => {
    const apply = (next: StoryFilter): void => {
      if (!sameFilter(next, get().filter)) set({ filter: next });
    };
    return {
      filter: NO_FILTER,
      setFilter: (filter) =>
        apply({
          categories: normalizeCategories(filter.categories),
          withinHours: filter.withinHours,
        }),
      toggleCategory: (category) => apply(toggleCategory(get().filter, category)),
      onlyCategory: (category) =>
        apply({ ...get().filter, categories: normalizeCategories([category]) }),
      setWithin: (hours) => apply({ ...get().filter, withinHours: hours }),
      clear: () => apply(NO_FILTER),
    };
  });
}

/** The app's single filter store. */
export const filterStore: FilterStore = createFilterStore();

export function useFilterStore<T>(selector: (state: FilterState) => T): T {
  return useStore(filterStore, selector);
}
