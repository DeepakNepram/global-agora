import { useEffect, useId, useRef, type JSX } from 'react';

import { isFilterActive, windowChoices, CATEGORY_LABELS, NEWS_CATEGORIES } from '@/core';
import { CATEGORY_HUES } from '@/globe';
import { filterStore, useFilterStore } from '@/state';

export interface FilterBarProps {
  /** AppConfig.historyWindowHours: which windows are offered. */
  readonly historyHours: number;
}

function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

const CHIP =
  'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * Category chips and a time window. A story they leave out is dimmed and
 * shrunk on the globe, never hidden. Each chip says its name, so colour is
 * never the only cue (Prompt 5.1); pressed chips are filled.
 */
export function FilterBar({ historyHours }: FilterBarProps): JSX.Element {
  const filter = useFilterStore((state) => state.filter);
  const windowId = useId();
  const active = isFilterActive(filter);
  const choices = windowChoices(historyHours);
  const store = filterStore.getState();
  const row = useRef<HTMLDivElement>(null);

  // A page opened with filters (a shared link, a reload) shows the first
  // pressed chip: on a phone the row scrolls, and it may sit off the edge.
  useEffect(() => {
    const element = row.current;
    const pressed = element?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!element || !pressed) return;
    element.scrollLeft = Math.max(0, pressed.offsetLeft - element.offsetLeft - 12);
  }, []);

  return (
    <div ref={row} className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
      <div role="group" aria-label="Show only these categories" className="flex gap-1.5">
        {NEWS_CATEGORIES.map((category) => {
          const on = filter.categories.includes(category);
          return (
            <button
              key={category}
              type="button"
              aria-pressed={on}
              onClick={() => store.toggleCategory(category)}
              className={
                on
                  ? `${CHIP} border-ink/60 bg-ink text-void`
                  : `${CHIP} border-ink/20 bg-panel/80 text-ink hover:bg-white/10`
              }
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: cssColor(CATEGORY_HUES[category]) }}
              />
              {CATEGORY_LABELS[category]}
            </button>
          );
        })}
      </div>

      <label htmlFor={windowId} className="sr-only">
        Time window
      </label>
      <select
        id={windowId}
        value={filter.withinHours ?? ''}
        onChange={(event) =>
          store.setWithin(
            event.currentTarget.value === '' ? null : Number(event.currentTarget.value),
          )
        }
        className={`${CHIP} appearance-none border-ink/20 bg-panel/80 pr-3 text-ink`}
      >
        <option value="">Any time</option>
        {choices.map((hours) => (
          <option key={hours} value={hours}>
            Last {hours} h
          </option>
        ))}
      </select>

      {active && (
        <button
          type="button"
          onClick={store.clear}
          className={`${CHIP} border-transparent text-muted underline underline-offset-2 hover:text-ink`}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
