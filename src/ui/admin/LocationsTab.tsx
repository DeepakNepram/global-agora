import { useEffect, useId, useState, type JSX } from 'react';

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
      <p role="status" className="min-h-5 text-sm text-ink">
        {message === null ? '' : locationMessageText(message)}
      </p>
      <LocationEditor controller={controller} />
      {list}
    </section>
  );
}
