import { useEffect, useState } from 'react';

import { decodeFilters, withFilters } from '@/core';
import { filterStore } from '@/state';

/**
 * Filter state lives in the URL (Prompt 3.4): read once on load, then every
 * change rewrites the address bar in place (replaceState: a filter is not a
 * page to go back to). Other fields in the query are kept.
 */
export function useFilterUrl(historyHours: number): void {
  // Applied during the first render, so the first frame is already filtered.
  useState(() => {
    filterStore.getState().setFilter(decodeFilters(window.location.search, historyHours));
    return null;
  });

  useEffect(
    () =>
      filterStore.subscribe((state, previous) => {
        if (state.filter === previous.filter) return;
        const { pathname, search, hash } = window.location;
        window.history.replaceState(
          window.history.state,
          '',
          `${pathname}${withFilters(search, state.filter)}${hash}`,
        );
      }),
    [],
  );
}
