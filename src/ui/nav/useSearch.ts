import { useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchOutletStories,
  indexOutlets,
  indexPlaces,
  indexStories,
  rowOfStory,
  search,
  NO_RESULTS,
  type NodeBuffer,
  type SearchResults,
} from '@/core';
import { monotonicNowMs, useTimeStore } from '@/state';

import { outletsData, placesData, useLazy, type LazyStatus } from '../data/lazyData';

/** Typing pauses this long before a search runs: short enough to feel instant. */
export const SEARCH_DEBOUNCE_MS = 80;

export type OutletList =
  | { readonly status: 'loading'; readonly outlet: string }
  | { readonly status: 'ready'; readonly outlet: string; readonly rows: readonly number[] }
  | { readonly status: 'error'; readonly outlet: string };

export interface SearchModel {
  readonly query: string;
  setQuery(query: string): void;
  /** The query the results are for (the debounced one). */
  readonly searched: string;
  readonly results: SearchResults;
  readonly places: LazyStatus;
  /** Starts loading the gazetteer and outlets: the first focus. */
  engage(): void;
  /** One outlet's stories, in place of the results, while chosen. */
  readonly outlet: OutletList | null;
  showOutlet(outlet: string | null): void;
}

export function useSearch(
  nodes: NodeBuffer | null,
  apiBaseUrl: string,
  historyHours: number,
): SearchModel {
  const [engaged, setEngaged] = useState(false);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [outlet, setOutlet] = useState<OutletList | null>(null);
  const outletRequest = useRef<AbortController | null>(null);
  const places = useLazy(placesData, engaged);
  const outlets = useLazy(outletsData(apiBaseUrl, historyHours), engaged);
  const nowSec = useTimeStore((state) => state.timeMs) / 1000;

  useEffect(() => {
    const timer = window.setTimeout(() => setSearched(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => () => outletRequest.current?.abort(), []);

  const placeIndex = useMemo(
    () => (places.value ? indexPlaces(places.value) : null),
    [places.value],
  );
  const storyIndex = useMemo(
    () => (nodes ? indexStories(nodes, places.value) : null),
    [nodes, places.value],
  );
  const outletIndex = useMemo(
    () => (outlets.value ? indexOutlets(outlets.value) : null),
    [outlets.value],
  );

  const results = useMemo(() => {
    if (searched.trim() === '') return NO_RESULTS;
    const start = monotonicNowMs();
    const found = search(
      { places: placeIndex, stories: storyIndex, nodes, outlets: outletIndex },
      searched,
      nowSec,
    );
    // Dev builds time each search; DevTools shows it under User Timing.
    if (import.meta.env.DEV) {
      performance.measure('agora:search', { start, end: monotonicNowMs() });
    }
    return found;
  }, [searched, placeIndex, storyIndex, outletIndex, nodes, nowSec]);

  const showOutlet = (name: string | null): void => {
    outletRequest.current?.abort();
    if (name === null) {
      setOutlet(null);
      return;
    }
    const controller = new AbortController();
    outletRequest.current = controller;
    setOutlet({ status: 'loading', outlet: name });
    fetchOutletStories(apiBaseUrl, name, historyHours, {
      fetch: (url, init) => fetch(url, init),
      signal: controller.signal,
    }).then(
      (list) => {
        if (controller.signal.aborted) return;
        // Ids the globe no longer has (a refresh in between) are left out.
        const rows = nodes
          ? list.ids.map((id) => rowOfStory(nodes, id)).filter((row) => row >= 0)
          : [];
        setOutlet({ status: 'ready', outlet: name, rows });
      },
      () => {
        if (!controller.signal.aborted) setOutlet({ status: 'error', outlet: name });
      },
    );
  };

  return {
    query,
    setQuery: (next) => {
      setQuery(next);
      if (outlet !== null) showOutlet(null);
    },
    searched,
    results,
    places: places.status,
    engage: () => setEngaged(true),
    outlet,
    showOutlet,
  };
}
