import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { isFilterActive, listKey, listStories, LIST_PAGE_SIZE, type NodeBuffer } from '@/core';
import {
  filterStore,
  storyStore,
  timeStore,
  useFilterStore,
  useStoryStore,
  useTimeStore,
  useViewStore,
  viewStore,
  wallClockNow,
} from '@/state';

import { revealIn, setViewFocus } from '../focus/viewFocus';
import { plural } from '../nav/searchOptions';
import { formatTimeLabel } from '../scrubber/timeLabel';
import { StoryListRow } from './StoryListRow';

export interface StoryListProps {
  /** The stories the globe draws; null until the first payload. */
  readonly nodes: NodeBuffer | null;
}

const MINUTE_MS = 60_000;
/** The story sheet's spring settles within this (sheetSpring.ts). */
const SHEET_SETTLE_MS = 360;

const SORT =
  'flex h-8 cursor-pointer items-center rounded-full px-3 text-xs font-medium text-ink ' +
  'has-[:checked]:bg-white/10 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent';
const TEXT_BUTTON =
  'rounded-full px-3 py-1.5 text-sm font-medium text-accent hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/** The row, by story id, among the list's buttons. */
function rowButton(list: HTMLElement | null, id: number): HTMLElement | null {
  return list?.querySelector<HTMLElement>(`[data-story-id="${id}"]`) ?? null;
}

/**
 * Every story the globe shows, as a list (Prompt 5.1): a view in its own
 * right, not a fallback. The scrubber's time and the filters drive it as
 * they drive the globe; newest first or most covered first, 50 at a time.
 * Up, Down, Home and End move between rows as well as Tab; a row opens the
 * same sheet a pin does, and closing it brings focus back to the row.
 */
export function StoryList({ nodes }: StoryListProps): JSX.Element {
  const headingId = useId();
  const filter = useFilterStore((state) => state.filter);
  const sort = useViewStore((state) => state.sort);
  const selectedId = useStoryStore((state) => state.selectedId);
  const sheetOpen = useStoryStore((state) => state.sheet !== 'closed');
  // What decides the rows: a story published, or aging out of the window. Play
  // moves the time every frame, and the list redraws only when this changes.
  const key = useTimeStore((state) => listKey(nodes, state.timeMs / 1000, filter));
  // The clock line by the minute, held still while Play runs.
  const minute = useTimeStore((state) =>
    state.motion === 'playing' ? -1 : Math.floor(state.timeMs / MINUTE_MS),
  );
  const isLive = useTimeStore((state) => state.isLive);
  const [shown, setShown] = useState(LIST_PAGE_SIZE);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const opened = useRef<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstNew = useRef<number | null>(null);

  const result = useMemo(
    () =>
      nodes && key !== ''
        ? listStories(nodes, timeStore.getState().timeMs / 1000, filter, sort)
        : null,
    // `key` stands for the time: the rows change only when it does.
    [nodes, key, filter, sort],
  );

  // A new sort or filter starts again at the top, a page long.
  useEffect(() => {
    setShown(LIST_PAGE_SIZE);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [filter, sort]);

  // Closing a story's sheet hands focus back to its row (or the heading,
  // when the row has paged out), shown above the scrubber.
  useEffect(
    () =>
      setViewFocus(() => {
        const row = opened.current === null ? null : rowButton(list.current, opened.current);
        if (row && scroller.current) revealIn(scroller.current, row);
        return row ?? heading.current;
      }),
    [],
  );

  // A row opened near the bottom is lifted clear of the sheet that opens
  // over it, once the sheet has come to rest (its spring takes 320 ms).
  useEffect(() => {
    if (!sheetOpen || selectedId === null) return;
    const timer = window.setTimeout(() => {
      const row = rowButton(list.current, selectedId);
      if (row && scroller.current) revealIn(scroller.current, row);
    }, SHEET_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [sheetOpen, selectedId]);

  // "Show more" moves focus to the first of the new rows, so the keyboard carries on there.
  useEffect(() => {
    if (firstNew.current === null) return;
    rowButton(list.current, firstNew.current)?.focus({ preventScroll: true });
    firstNew.current = null;
  }, [shown]);

  const onOpen = (id: number): void => {
    opened.current = id;
    storyStore.getState().open(id);
  };

  const onRowKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const buttons = [...(list.current?.querySelectorAll<HTMLElement>('[data-story-id]') ?? [])];
    const at = buttons.indexOf(event.currentTarget);
    const next =
      event.key === 'ArrowDown'
        ? at + 1
        : event.key === 'ArrowUp'
          ? at - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : null;
    const target =
      next === null ? undefined : buttons[Math.max(0, Math.min(next, buttons.length - 1))];
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
    if (scroller.current) revealIn(scroller.current, target);
  };

  const nowMs = wallClockNow();
  const rows = result?.rows ?? [];
  const visible = rows.slice(0, shown);
  const left = (result?.published ?? 0) - rows.length;
  const when =
    minute === -1
      ? 'so far'
      : isLive
        ? 'live'
        : `up to ${formatTimeLabel(timeStore.getState().timeMs, nowMs, false).utc}`;

  return (
    <div
      ref={scroller}
      // Scroll padding keeps a row Tab moves to clear of the search bar and the
      // scrubber, never hidden under them (WCAG 2.4.11).
      className={`absolute inset-0 scroll-pb-44 scroll-pt-36 overflow-y-auto overscroll-contain bg-void pt-36 ${sheetOpen ? 'pb-[45vh]' : 'pb-44'}`}
    >
      <section aria-labelledby={headingId} className="mx-auto flex max-w-3xl flex-col gap-3 px-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div>
            <h2
              id={headingId}
              ref={heading}
              tabIndex={-1}
              className="text-lg font-semibold outline-none"
            >
              Stories
            </h2>
            <p className="text-sm text-muted">
              {nodes === null
                ? 'Loading stories…'
                : `${plural(rows.length, 'story', 'stories')}, ${when}`}
            </p>
          </div>
          <fieldset className="flex gap-0.5 rounded-full border border-ink/20 p-0.5">
            <legend className="sr-only">Order</legend>
            {(
              [
                ['newest', 'Newest'],
                ['covered', 'Most covered'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={SORT}>
                <input
                  type="radio"
                  name={`${headingId}-sort`}
                  value={value}
                  checked={sort === value}
                  onChange={() => viewStore.getState().setSort(value)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </fieldset>
        </div>

        {left > 0 && isFilterActive(filter) && (
          <p className="flex flex-wrap items-center gap-2 px-1 text-sm text-muted">
            {plural(left, 'more story is', 'more stories are')} left out by the filters.
            <button
              type="button"
              className={TEXT_BUTTON}
              onClick={() => filterStore.getState().clear()}
            >
              Clear filters
            </button>
          </p>
        )}

        {nodes !== null && rows.length === 0 && (
          <p className="px-1 text-sm text-muted">
            {isFilterActive(filter) ? 'No stories match the filters.' : 'No stories by this time.'}
          </p>
        )}

        <ul ref={list} aria-labelledby={headingId} className="flex flex-col gap-1">
          {nodes &&
            visible.map((row) => (
              <StoryListRow
                key={nodes.ids[row]}
                nodes={nodes}
                row={row}
                nowMs={nowMs}
                current={sheetOpen && nodes.ids[row] === selectedId}
                onOpen={onOpen}
                onKeyDown={onRowKey}
              />
            ))}
        </ul>

        {rows.length > shown && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-sm text-muted">
              Showing {shown} of {rows.length}
            </p>
            <button
              type="button"
              className={TEXT_BUTTON}
              onClick={() => {
                firstNew.current = nodes?.ids[rows[shown] ?? -1] ?? null;
                setShown((count) => count + LIST_PAGE_SIZE);
              }}
            >
              Show {Math.min(LIST_PAGE_SIZE, rows.length - shown)} more
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
