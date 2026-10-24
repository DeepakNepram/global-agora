import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { useLocationsStore, type LocationsController } from '@/state/adminLocations';

import { INPUT, LABEL, PRIMARY, SECONDARY } from '../account/accountStyles';
import { formatAgoLong } from '../story/format';
import { locationMessageText } from './adminView';
import { LocationEditor } from './LocationEditor';

export interface LocationsTabProps {
  readonly controller: LocationsController;
  readonly nowMs: number;
}

/**
 * The location correction tool: stories readers said are in the wrong
 * place, most reported first, or any story by its share link. Picking one
 * opens the map above the list.
 */
export function LocationsTab({ controller, nowMs }: LocationsTabProps): JSX.Element {
  const id = useId();
  const status = useLocationsStore((state) => state.status);
  const items = useLocationsStore((state) => state.items);
  const selected = useLocationsStore((state) => state.selected);
  const message = useLocationsStore((state) => state.message);
  const [link, setLink] = useState('');
  const moveButtons = useRef(new Map<string, HTMLButtonElement>());
  const outcome = useRef<HTMLParagraphElement>(null);
  const lastSelected = useRef<string | null>(null);

  // A closed editor hands focus back: to its story's button after Cancel,
  // or to the outcome line after a move (the story has left the list).
  useEffect(() => {
    const was = lastSelected.current;
    lastSelected.current = selected?.storyId ?? null;
    if (selected !== null || was === null) return;
    (moveButtons.current.get(was) ?? outcome.current)?.focus();
  }, [selected]);

  useEffect(() => {
    void controller.load();
  }, [controller]);

  let list: JSX.Element;
  if (status === 'loading' || status === 'idle') {
    list = <p className="text-sm text-muted">Loading the reports…</p>;
  } else if (status === 'failed') {
    list = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted">The reported locations could not be loaded.</p>
        <button type="button" className={PRIMARY} onClick={() => void controller.load()}>
          Try again
        </button>
      </div>
    );
  } else if (items.length === 0) {
    list = <p className="text-sm text-muted">No reports of a pin in the wrong place.</p>;
  } else {
    list = (
      <ol aria-label="Stories reported as in the wrong place" className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.storyId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink/10 p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{item.title}</p>
              <p className="text-xs text-muted">
                {item.placeName ?? item.countryCode ?? 'No place'} · {item.reports} report
                {item.reports === 1 ? '' : 's'}
                {item.lastReportedAtMs !== null &&
                  `, last ${formatAgoLong(item.lastReportedAtMs, nowMs).toLowerCase()}`}
              </p>
            </div>
            <button
              type="button"
              ref={(button) => {
                if (button) moveButtons.current.set(item.storyId, button);
                else moveButtons.current.delete(item.storyId);
              }}
              className={SECONDARY}
              aria-pressed={selected?.storyId === item.storyId}
              aria-label={`Move the pin of “${item.title}”`}
              onClick={() => controller.select(item)}
            >
              Move the pin…
            </button>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      {/* The level between the page's h1 and the editor's h3, for heading navigation. */}
      <h2 className="sr-only">Pins in the wrong place</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void controller.lookup(link);
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-link`} className={LABEL}>
            Any story: paste its share link, or its number
          </label>
          <input
            id={`${id}-link`}
            type="text"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            className={INPUT}
          />
        </div>
        <button type="submit" className={SECONDARY} disabled={link.trim() === ''}>
          Find
        </button>
      </form>
      <p
        ref={outcome}
        role="status"
        tabIndex={-1}
        className="min-h-5 text-sm text-ink outline-none"
      >
        {message === null ? '' : locationMessageText(message)}
      </p>
      <LocationEditor controller={controller} />
      {list}
    </section>
  );
}
