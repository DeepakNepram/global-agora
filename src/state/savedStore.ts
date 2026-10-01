import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { wallClockNow } from './clock';
import { browserStorage, readJson, writeJson, type KeyValueStorage } from './persist';

/**
 * Stories saved on this device. Signed out, saves live in localStorage;
 * Prompt 3.4 adds the Saved list and moves them to an account on sign-in.
 *
 * Each save is a snapshot, not just an id: stories leave the API after 48 h,
 * and a saved one must still say what it was. The cap is
 * AppConfig.savedStoryLimit, a tier boundary passed in, never a literal.
 */

export interface SavedStory {
  /** The payload id. */
  readonly id: number;
  readonly headline: string;
  readonly place: string;
  readonly publishedAtMs: number;
  readonly savedAtMs: number;
}

export type SaveResult = 'saved' | 'removed' | 'full';

export interface SavedState {
  /** Newest save first. */
  readonly stories: readonly SavedStory[];
  /** Saves the story, or removes it if saved; 'full' at `limit` saves. */
  toggle(story: Omit<SavedStory, 'savedAtMs'>, limit: number): SaveResult;
}

export type SavedStore = StoreApi<SavedState>;

export const SAVED_STORAGE_KEY = 'agora.saved.v1';

function isSavedStory(value: unknown): value is SavedStory {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'number' &&
    Number.isSafeInteger(v['id']) &&
    typeof v['headline'] === 'string' &&
    typeof v['place'] === 'string' &&
    typeof v['publishedAtMs'] === 'number' &&
    typeof v['savedAtMs'] === 'number'
  );
}

/** What storage holds, keeping only well-formed entries and one per story. */
function load(storage: KeyValueStorage | null): SavedStory[] {
  const raw = readJson(storage, SAVED_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  return raw.filter((item): item is SavedStory => {
    if (!isSavedStory(item) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function createSavedStore(
  storage: KeyValueStorage | null = browserStorage(),
  now: () => number = wallClockNow,
): SavedStore {
  return createStore<SavedState>()((set, get) => ({
    stories: load(storage),

    toggle(story, limit) {
      const { stories } = get();
      let next: SavedStory[];
      let result: SaveResult;
      if (stories.some((saved) => saved.id === story.id)) {
        next = stories.filter((saved) => saved.id !== story.id);
        result = 'removed';
      } else if (stories.length >= limit) {
        return 'full';
      } else {
        next = [{ ...story, savedAtMs: now() }, ...stories];
        result = 'saved';
      }
      // Kept in memory even if storage refuses, so the button tells the truth
      // for this visit.
      set({ stories: next });
      writeJson(storage, SAVED_STORAGE_KEY, next);
      return result;
    },
  }));
}

/** The app's single saved-stories store. */
export const savedStore: SavedStore = createSavedStore();

export function useSavedStore<T>(selector: (state: SavedState) => T): T {
  return useStore(savedStore, selector);
}
