import { useState, type JSX, type ReactNode } from 'react';

import type { NodeBuffer } from '@/core';

import { nextAnnouncement } from '../announce';
import { FilterBar } from './FilterBar';
import type { ViewTarget } from './viewNavigation';
import { SearchBox } from './SearchBox';
import { useFilterUrl } from './useFilterUrl';

export interface NavLayerProps {
  readonly nodes: NodeBuffer | null;
  /** The camera, and the canvas's size, which framing a place needs. */
  readonly target: ViewTarget;
  readonly apiBaseUrl: string;
  /** AppConfig.historyWindowHours. */
  readonly historyHours: number;
  /** Buttons at the end of the search row (Following, Saved). */
  readonly actions?: ReactNode;
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

  return (
    <nav
      aria-label="Search and filters"
      // Pins under it are not visible, so keyboard focus skips them (Prompt 5.1).
      data-covers="top"
      className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3 [&>*]:pointer-events-auto"
    >
      <div className="flex items-center gap-2">
        <SearchBox
          nodes={nodes}
          target={target}
          apiBaseUrl={apiBaseUrl}
          historyHours={historyHours}
          announce={announce}
        />
        {actions}
      </div>
      <FilterBar historyHours={historyHours} />
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </nav>
  );
}
