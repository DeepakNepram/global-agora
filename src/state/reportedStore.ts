import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { browserStorage, readJson, writeJson, type KeyValueStorage } from './persist';

/**
 * Stories this device has already reported as wrongly placed, so the report
 * link becomes "Reported" and a reader cannot count twice by accident. Only
 * ids, and only here: the server keeps a bare count.
 */

export interface ReportedState {
  readonly ids: readonly number[];
  add(id: number): void;
}

export type ReportedStore = StoreApi<ReportedState>;

export const REPORTED_STORAGE_KEY = 'agora.locationReports.v1';

/** Stories live 48 h, so the oldest ids stop mattering long before this many. */
export const REPORTED_MEMORY = 500;

function load(storage: KeyValueStorage | null): number[] {
  const raw = readJson(storage, REPORTED_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id));
}

export function createReportedStore(
  storage: KeyValueStorage | null = browserStorage(),
): ReportedStore {
  return createStore<ReportedState>()((set, get) => ({
    ids: load(storage),

    add(id) {
      if (get().ids.includes(id)) return;
      const ids = [...get().ids, id].slice(-REPORTED_MEMORY);
      set({ ids });
      writeJson(storage, REPORTED_STORAGE_KEY, ids);
    },
  }));
}

export const reportedStore: ReportedStore = createReportedStore();

export function useReportedStore<T>(selector: (state: ReportedState) => T): T {
  return useStore(reportedStore, selector);
}
