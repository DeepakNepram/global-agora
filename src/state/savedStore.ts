import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { isSavedStory, type LibraryRemote, type SavedStory } from '@/core';

import { wallClockNow } from './clock';
import { createLibraryList } from './libraryList';
import { browserStorage, type KeyValueStorage } from './persist';

/**
 * Saved stories. Signed out they live in localStorage; signed in, in the
 * account (library.ts moves them up on sign-in, dropping nothing).
 *
 * Each save is a snapshot (SavedStory): stories leave the API after 48 h, and
 * a saved one must still say what it was. The cap is
 * AppConfig.savedStoryLimit, a tier boundary passed in, never a literal.
 */

export type { SavedStory };

export type SaveResult = 'saved' | 'removed' | 'full';

export interface SavedState {
  /** Newest save first. */
  readonly stories: readonly SavedStory[];
  /** Account writes that failed and were read back: the UI says so. */
  readonly failures: number;
  /** Saves the story, or removes it if saved; 'full' at `limit` saves. */
  toggle(story: Omit<SavedStory, 'savedAtMs'>, limit: number): SaveResult;
  remove(id: number): void;
  attach(remote: LibraryRemote | null, stories?: readonly SavedStory[]): void;
  deviceItems(): SavedStory[];
  forgetOnDevice(keys: ReadonlySet<string>): void;
}

export type SavedStore = StoreApi<SavedState>;

export const SAVED_STORAGE_KEY = 'agora.saved.v1';

export function savedKey(story: Pick<SavedStory, 'id'>): string {
  return String(story.id);
}

export function createSavedStore(
  storage: KeyValueStorage | null = browserStorage(),
  now: () => number = wallClockNow,
): SavedStore {
  return createStore<SavedState>()((set, get) => {
    const list = createLibraryList<SavedStory>({
      storage,
      storageKey: SAVED_STORAGE_KEY,
      isItem: isSavedStory,
      keyOf: savedKey,
      backend: {
        list: (remote) => remote.listSaved(),
        add: (remote, stories) => remote.addSaved(stories),
        remove: (remote, story) => remote.removeSaved(story.id),
      },
      onChange: (stories) => set({ stories }),
      onFailure: () => set({ failures: get().failures + 1 }),
    });

    return {
      stories: list.items(),
      failures: 0,

      toggle(story, limit) {
        const current = list.items();
        const existing = current.find((saved) => saved.id === story.id);
        if (existing) {
          list.apply(
            current.filter((saved) => saved !== existing),
            { remove: existing },
          );
          return 'removed';
        }
        if (current.length >= limit) return 'full';
        const saved: SavedStory = { ...story, savedAtMs: now() };
        list.apply([saved, ...current], { add: [saved] });
        return 'saved';
      },

      remove(id) {
        const current = list.items();
        const existing = current.find((saved) => saved.id === id);
        if (!existing) return;
        list.apply(
          current.filter((saved) => saved !== existing),
          { remove: existing },
        );
      },

      attach: (remote, stories) => list.attach(remote, stories),
      deviceItems: () => list.deviceItems(),
      forgetOnDevice: (keys) => list.forgetOnDevice(keys),
    };
  });
}

/** The app's single saved-stories store. */
export const savedStore: SavedStore = createSavedStore();

export function useSavedStore<T>(selector: (state: SavedState) => T): T {
  return useStore(savedStore, selector);
}
