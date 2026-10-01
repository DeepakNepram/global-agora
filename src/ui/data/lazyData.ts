import { useEffect, useSyncExternalStore } from 'react';

import { fetchOutlets, fetchPlaces, type Gazetteer, type OutletsIndex } from '@/core';
import { monotonicNowMs } from '@/state';

/**
 * Data fetched on first need, never at start: the gazetteer (~85 KB) for
 * search, place follows and the home city, and the outlet index for search.
 * Each is shared by everything that wants it; a failure clears it so the
 * next want tries again.
 */

export type LazyStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface Lazy<T> {
  value(): T | null;
  status(): LazyStatus;
  /** Starts a load unless one is running or the value is fresh. */
  want(): void;
  subscribe(listener: () => void): () => void;
}

export function createLazy<T>(load: () => Promise<T>, maxAgeMs = Infinity): Lazy<T> {
  let value: T | null = null;
  let status: LazyStatus = 'idle';
  let loadedAt = -Infinity;
  const listeners = new Set<() => void>();
  const emit = (): void => listeners.forEach((listener) => listener());

  return {
    value: () => value,
    status: () => status,
    want() {
      if (status === 'loading') return;
      if (status === 'ready' && monotonicNowMs() - loadedAt < maxAgeMs) return;
      status = 'loading';
      emit();
      load().then(
        (loaded) => {
          value = loaded;
          loadedAt = monotonicNowMs();
          status = 'ready';
          emit();
        },
        () => {
          // A stale value beats none; the next want tries again.
          status = value === null ? 'error' : 'ready';
          emit();
        },
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Reads `lazy`, loading it once `wanted` turns true. */
export function useLazy<T>(
  lazy: Lazy<T>,
  wanted: boolean,
): { value: T | null; status: LazyStatus } {
  const value = useSyncExternalStore(lazy.subscribe, lazy.value);
  const status = useSyncExternalStore(lazy.subscribe, lazy.status);
  useEffect(() => {
    if (wanted) lazy.want();
  }, [lazy, wanted]);
  return { value, status };
}

/** The gazetteer: it does not change while the app runs. */
export const placesData: Lazy<Gazetteer> = createLazy(() =>
  fetchPlaces(import.meta.env.BASE_URL, { fetch: (url, init) => fetch(url, init) }),
);

/** Outlets follow the payload, so a search opened ten minutes later asks again. */
const OUTLETS_MAX_AGE_MS = 10 * 60 * 1000;
const outlets = new Map<string, Lazy<OutletsIndex>>();

export function outletsData(apiBaseUrl: string, hours: number): Lazy<OutletsIndex> {
  const key = `${apiBaseUrl}|${hours}`;
  let found = outlets.get(key);
  if (!found) {
    found = createLazy(
      () => fetchOutlets(apiBaseUrl, hours, { fetch: (url, init) => fetch(url, init) }),
      OUTLETS_MAX_AGE_MS,
    );
    outlets.set(key, found);
  }
  return found;
}
