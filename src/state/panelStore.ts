import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

/**
 * Which library tab is open over the globe, if any: the Following feed or
 * the Saved list (Prompt 3.4). One sheet holds both, as two tabs, and it
 * never shares the screen with a story's sheet: opening one closes the other.
 */

export type LibraryPanel = 'following' | 'saved';

export interface PanelState {
  readonly panel: LibraryPanel | null;
  open(panel: LibraryPanel): void;
  close(): void;
}

export type PanelStore = StoreApi<PanelState>;

export function createPanelStore(): PanelStore {
  return createStore<PanelState>()((set) => ({
    panel: null,
    open: (panel) => set({ panel }),
    close: () => set({ panel: null }),
  }));
}

/** The app's single panel store. */
export const panelStore: PanelStore = createPanelStore();

export function usePanelStore<T>(selector: (state: PanelState) => T): T {
  return useStore(panelStore, selector);
}
