import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

/**
 * Whether the device says it is online (Prompt 5.2). The browser's word is
 * optimistic (a captive portal counts as online), so the news banner also
 * reads nodesStore.savedAtMs, which only a failed request sets.
 */
export interface ConnectivityState {
  readonly online: boolean;
  setOnline(online: boolean): void;
}

export type ConnectivityStore = StoreApi<ConnectivityState>;

export function createConnectivityStore(online = true): ConnectivityStore {
  return createStore<ConnectivityState>()((set) => ({
    online,
    setOnline(next) {
      set({ online: next });
    },
  }));
}

/** The app's one; src/ui/data/useConnectivity.ts keeps it current. */
export const connectivityStore: ConnectivityStore = createConnectivityStore();

export function useConnectivityStore<T>(selector: (state: ConnectivityState) => T): T {
  return useStore(connectivityStore, selector);
}
