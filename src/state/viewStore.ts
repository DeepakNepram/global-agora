import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { StorySort } from '@/core';

import { browserStorage, readJson, writeJson, type KeyValueStorage } from './persist';

/**
 * How the stories are shown (Prompt 5.1): on the globe (the flat map under
 * reduced motion) or as a list, and how the list is sorted. A per-device
 * preference: a reader who chooses the list finds it there next time.
 */

export type NewsLayout = 'visual' | 'list';

export const VIEW_STORAGE_KEY = 'agora.view.v1';

export interface ViewState {
  readonly layout: NewsLayout;
  readonly sort: StorySort;
  setLayout(layout: NewsLayout): void;
  setSort(sort: StorySort): void;
}

export type ViewStore = StoreApi<ViewState>;

interface Stored {
  readonly layout: NewsLayout;
  readonly sort: StorySort;
}

function restore(storage: KeyValueStorage | null): Stored {
  const value = readJson(storage, VIEW_STORAGE_KEY);
  const record = typeof value === 'object' && value !== null ? (value as Partial<Stored>) : {};
  return {
    layout: record.layout === 'list' ? 'list' : 'visual',
    sort: record.sort === 'covered' ? 'covered' : 'newest',
  };
}

export function createViewStore(storage: KeyValueStorage | null = browserStorage()): ViewStore {
  return createStore<ViewState>()((set, get) => {
    const save = (next: Stored): void => {
      set(next);
      writeJson(storage, VIEW_STORAGE_KEY, next);
    };
    return {
      ...restore(storage),
      setLayout: (layout) => {
        if (layout !== get().layout) save({ layout, sort: get().sort });
      },
      setSort: (sort) => {
        if (sort !== get().sort) save({ layout: get().layout, sort });
      },
    };
  });
}

/** The app's single view store. */
export const viewStore: ViewStore = createViewStore();

export function useViewStore<T>(selector: (state: ViewState) => T): T {
  return useStore(viewStore, selector);
}
