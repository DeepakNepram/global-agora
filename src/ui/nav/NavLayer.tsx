import { useRef, useState, type JSX, type ReactNode } from 'react';

import type { NodeBuffer } from '@/core';

import { nextAnnouncement } from '../announce';
import { FilterBar } from './FilterBar';
import type { ViewTarget } from './viewNavigation';
import { SearchBox } from './SearchBox';
import { useFilterUrl } from './useFilterUrl';
import { useUnderFullSheet } from './useUnderFullSheet';

/** A row a full-height sheet covers fades out, and leaves the Tab order (inert). */
const UNDER_SHEET = 'invisible opacity-0';
const ROW_MOTION = 'transition-[opacity,visibility] duration-200';

export interface NavLayerProps {
  readonly nodes: NodeBuffer | null;
  /** The camera, and the canvas's size, which framing a place needs. */
  readonly target: ViewTarget;
  readonly apiBaseUrl: string;
  /** AppConfig.historyWindowHours. */
  readonly historyHours: number;
  /** Buttons at the end of the search row (Following, Saved). */
  readonly actions?: ReactNode;
  /** First in the filter row: the view switch. */
  readonly leading?: ReactNode;
  /** Over the list, an opaque bar: text scrolling under see-through controls is unreadable. */
  readonly solid?: boolean;
}

/**
 * The secondary navigation over the top of the globe (Prompt 3.4): search,
 * then the filters. Only its controls take pointer events, so the globe
 * stays draggable between and around them.
 */
export function NavLayer(props: NavLayerProps): JSX.Element {
  const { nodes, target, apiBaseUrl, historyHours, actions } = props;
  const [announcement, setAnnouncement] = useState('');
  useFilterUrl(historyHours);
  const announce = (text: string): void =>
    setAnnouncement((previous) => nextAnnouncement(previous, text));
  const navigation = useRef<HTMLElement>(null);
  const searchRow = useRef<HTMLDivElement>(null);
  const filterRow = useRef<HTMLDivElement>(null);
  const searchCovered = useUnderFullSheet(searchRow, navigation);
  const filtersCovered = useUnderFullSheet(filterRow, navigation);

  return (
    <nav
      ref={navigation}
      aria-label="Search and filters"
      // Pins under it are not visible, so keyboard focus skips them (Prompt 5.1).
      data-covers="top"
      className={`pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3 [&>*]:pointer-events-auto ${props.solid === true ? 'bg-void' : ''}`}
    >
      <div
        ref={searchRow}
        inert={searchCovered}
        className={`flex items-center gap-2 ${ROW_MOTION} ${searchCovered ? UNDER_SHEET : ''}`}
      >
        <SearchBox
          nodes={nodes}
          target={target}
          apiBaseUrl={apiBaseUrl}
          historyHours={historyHours}
          announce={announce}
        />
        {actions}
      </div>
      <div
        ref={filterRow}
        inert={filtersCovered}
        className={`${ROW_MOTION} ${filtersCovered ? UNDER_SHEET : ''}`}
      >
        <FilterBar historyHours={historyHours} leading={props.leading} />
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </nav>
  );
}
