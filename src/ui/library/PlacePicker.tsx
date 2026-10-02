import { useId, useMemo, useState, type JSX, type KeyboardEvent } from 'react';

import { indexPlaces, search, type PlaceResult } from '@/core';

import { placesData, useLazy } from '../data/lazyData';

export interface PlacePickerProps {
  /** The field's visible label. */
  readonly label: string;
  readonly placeholder?: string;
  readonly onChoose: (place: PlaceResult) => void;
}

/** Places only, five at most: a follow or a home city needs no more. */
const LIMIT = 5;

/**
 * A field that finds a country or city in the gazetteer: the Following tab's
 * "Follow a place" and the onboarding's home city. An ARIA 1.2 combobox, like
 * search. Typing is all it takes: no location permission, no IP guess.
 */
export function PlacePicker({ label, placeholder, onChoose }: PlacePickerProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const places = useLazy(placesData, true);
  const index = useMemo(() => (places.value ? indexPlaces(places.value) : null), [places.value]);
  const inputId = useId();
  const listId = useId();

  const found = useMemo(
    () =>
      index
        ? search(
            { places: index, stories: null, nodes: null, outlets: null },
            query,
            0,
          ).places.slice(0, LIMIT)
        : [],
    [index, query],
  );
  const showing = open && query.trim() !== '';

  const choose = (place: PlaceResult): void => {
    setQuery('');
    setActive(-1);
    setOpen(false);
    onChoose(place);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && found.length > 0) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + found.length) % found.length);
      setOpen(true);
    } else if (event.key === 'Enter') {
      const chosen = found[active] ?? (found.length === 1 ? found[0] : undefined);
      if (chosen) {
        event.preventDefault();
        choose(chosen);
      }
    } else if (event.key === 'Escape' && showing) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  const status =
    places.status === 'loading' || places.status === 'idle'
      ? 'Loading places…'
      : places.status === 'error'
        ? 'Places could not be loaded.'
        : found.length === 0
          ? 'No place by that name.'
          : `${found.length} place${found.length === 1 ? '' : 's'}`;

  return (
    <div className="relative">
      <label htmlFor={inputId} className="mb-1 block text-xs text-muted">
        {label}
      </label>
      <input
        id={inputId}
        type="search"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && found[active] ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-full border border-ink/20 bg-void px-4 text-sm text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
      <div
        id={listId}
        role="listbox"
        aria-label={`${label}: results`}
        hidden={!showing}
        className="absolute inset-x-0 top-full z-10 mt-1 rounded-2xl border border-ink/15 bg-panel p-1 shadow-xl"
      >
        {found.map((place, i) => (
          <div
            key={place.key}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(place)}
            className={`cursor-pointer rounded-xl px-3 py-2 ${i === active ? 'bg-white/10' : 'hover:bg-white/5'}`}
          >
            <div className="text-sm text-ink">{place.label}</div>
            <div className="text-xs text-muted">{place.detail}</div>
          </div>
        ))}
        {found.length === 0 && <p className="px-3 py-2 text-sm text-muted">{status}</p>}
      </div>
      <p role="status" className="sr-only">
        {showing ? status : ''}
      </p>
    </div>
  );
}
