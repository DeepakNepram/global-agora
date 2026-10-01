import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { resultCount, type NodeBuffer } from '@/core';

import type { GlobeTarget } from './globeNavigation';
import { groupsFor, plural } from './searchOptions';
import { useSearch } from './useSearch';

export interface SearchBoxProps {
  readonly nodes: NodeBuffer | null;
  readonly target: GlobeTarget;
  readonly apiBaseUrl: string;
  readonly historyHours: number;
  /** Says what a choice did, in the page's live region. */
  readonly announce: (text: string) => void;
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Search: places, topics, stories and outlets (Prompt 3.4), as an ARIA 1.2
 * combobox. Arrow keys move through the results, Enter chooses, Escape steps
 * back (out of an outlet, then closes, then clears). "/" anywhere focuses it.
 */
export function SearchBox(props: SearchBoxProps): JSX.Element {
  const model = useSearch(props.nodes, props.apiBaseUrl, props.historyHours);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const labelId = useId();

  const close = (keepText: string | null): void => {
    setOpen(false);
    setActive(-1);
    if (keepText !== null) model.setQuery(keepText);
  };
  const groups = groupsFor(model, props, close);
  const options = groups.flatMap((group) => group.options);
  const typed = model.query.trim() !== '';
  const showing = open && (typed || model.outlet !== null);

  // New results put the highlight back on none, so Enter never picks a stale one.
  useEffect(() => setActive(-1), [model.results, model.outlet]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + options.length) % options.length);
    } else if (event.key === 'Enter') {
      const chosen = options[active] ?? (options.length === 1 ? options[0] : undefined);
      if (chosen) {
        event.preventDefault();
        chosen.pick();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (model.outlet !== null) model.showOutlet(null);
      else if (showing) close(null);
      else model.setQuery('');
    }
  };

  const status = !typed
    ? ''
    : model.outlet?.status === 'loading'
      ? 'Loading stories…'
      : model.outlet?.status === 'error'
        ? 'Those stories could not be loaded.'
        : model.query !== model.searched
          ? ''
          : options.length > 0
            ? plural(
                model.outlet ? options.length : resultCount(model.results),
                'result',
                'results',
              )
            : model.places === 'loading'
              ? 'Loading places…'
              : `No matches for “${model.searched.trim()}”.`;

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-md">
      <label id={labelId} className="sr-only">
        Search places, topics, stories and outlets
      </label>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-labelledby={labelId}
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && options[active] ? options[active].id : undefined}
        placeholder="Search places, topics, outlets"
        autoComplete="off"
        spellCheck={false}
        value={model.query}
        onChange={(event) => {
          model.setQuery(event.currentTarget.value);
          setOpen(true);
        }}
        onFocus={() => {
          model.engage();
          setOpen(true);
        }}
        onBlur={() => close(null)}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-full border border-ink/20 bg-panel/90 px-4 text-sm text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
      <div
        id={listId}
        role="listbox"
        aria-label="Search results"
        hidden={!showing}
        className="absolute inset-x-0 top-full z-40 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-ink/15 bg-panel p-1 shadow-xl"
      >
        {model.outlet !== null && (
          <p className="px-3 pb-1 pt-2 text-xs text-muted">Escape goes back to the results.</p>
        )}
        {groups.map((group) => (
          <div key={group.title} role="group" aria-label={group.title}>
            <div
              aria-hidden="true"
              className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted"
            >
              {group.title}
            </div>
            {group.options.map((option) => {
              const selected = options[active]?.id === option.id;
              return (
                <div
                  key={option.id}
                  id={option.id}
                  role="option"
                  aria-selected={selected}
                  // Keeps focus in the field, so the list stays a combobox's.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={option.pick}
                  className={`cursor-pointer rounded-xl px-3 py-2 ${selected ? 'bg-white/10' : 'hover:bg-white/5'}`}
                >
                  <div className="truncate text-sm text-ink">{option.label}</div>
                  {option.detail !== '' && (
                    <div className="truncate text-xs text-muted">{option.detail}</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {options.length === 0 && status !== '' && (
          <p className="px-3 py-2 text-sm text-muted">{status}</p>
        )}
      </div>
      <p role="status" className="sr-only">
        {showing ? status : ''}
      </p>
    </div>
  );
}
