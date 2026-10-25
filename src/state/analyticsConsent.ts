import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { ANALYTICS_OPT_OUT_KEY } from '@/core';

import { browserStorage, readJson, writeJson, type KeyValueStorage } from './persist';

/**
 * The privacy page's "Count my visits" (Prompt 5.2): on unless the reader
 * turns it off on this device. The browser's own Global Privacy Control or
 * Do Not Track turn counting off whatever this says.
 */
export interface AnalyticsConsentState {
  readonly counting: boolean;
  setCounting(counting: boolean): void;
}

export type AnalyticsConsentStore = StoreApi<AnalyticsConsentState>;

export function createAnalyticsConsentStore(
  storage: KeyValueStorage | null = browserStorage(),
): AnalyticsConsentStore {
  const stored = readJson(storage, ANALYTICS_OPT_OUT_KEY);
  const counting =
    typeof stored === 'object' && stored !== null
      ? (stored as { count?: unknown }).count !== false
      : true;
  return createStore<AnalyticsConsentState>()((set) => ({
    counting,
    setCounting(next) {
      set({ counting: next });
      writeJson(storage, ANALYTICS_OPT_OUT_KEY, { count: next });
    },
  }));
}

export const analyticsConsentStore: AnalyticsConsentStore = createAnalyticsConsentStore();

export function useAnalyticsConsent<T>(selector: (state: AnalyticsConsentState) => T): T {
  return useStore(analyticsConsentStore, selector);
}
