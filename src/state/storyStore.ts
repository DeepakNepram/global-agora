import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

/**
 * Which story is open and how far its sheet is drawn up: closed, the peek
 * card (a third of the screen) or the full sheet (90 %).
 *
 * Closing keeps `selectedId`, so the sheet still shows its story while it
 * slides away; the globe's ring follows `ringedStory`, which clears at once.
 */

export type SheetState = 'closed' | 'peek' | 'full';

export interface StoryState {
  /** The payload id of the story shown, or null before any. */
  readonly selectedId: number | null;
  readonly sheet: SheetState;
  /** Shows story `id`: opens the peek card, or switches an open sheet to it. */
  open(id: number): void;
  /** Peek → full. */
  expand(): void;
  /** One step down: full → peek → closed. */
  collapse(): void;
  close(): void;
  /** Where a drag let the sheet come to rest. */
  setSheet(sheet: SheetState): void;
}

export type StoryStore = StoreApi<StoryState>;

export function createStoryStore(): StoryStore {
  return createStore<StoryState>()((set, get) => ({
    selectedId: null,
    sheet: 'closed',

    open(id) {
      if (!Number.isSafeInteger(id) || id < 1) return;
      set({ selectedId: id, sheet: get().sheet === 'closed' ? 'peek' : get().sheet });
    },

    expand() {
      if (get().sheet === 'peek') set({ sheet: 'full' });
    },

    collapse() {
      const { sheet } = get();
      if (sheet === 'full') set({ sheet: 'peek' });
      else if (sheet === 'peek') set({ sheet: 'closed' });
    },

    close() {
      if (get().sheet !== 'closed') set({ sheet: 'closed' });
    },

    setSheet(sheet) {
      if (get().selectedId === null && sheet !== 'closed') return;
      if (sheet !== get().sheet) set({ sheet });
    },
  }));
}

/** The story the globe rings: the one shown, while its sheet is open. */
export function ringedStory(state: StoryState): number | null {
  return state.sheet === 'closed' ? null : state.selectedId;
}

/** The app's single story store. */
export const storyStore: StoryStore = createStoryStore();

export function useStoryStore<T>(selector: (state: StoryState) => T): T {
  return useStore(storyStore, selector);
}
