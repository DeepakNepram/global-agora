import type { JSX, KeyboardEvent } from 'react';

import { categoryAt, type NodeBuffer } from '@/core';

import { CategoryLabel } from '../category/CategoryMark';
import { plural } from '../nav/searchOptions';
import { formatAgo } from '../story/format';

export interface StoryListRowProps {
  readonly nodes: NodeBuffer;
  readonly row: number;
  readonly nowMs: number;
  /** This story's sheet is open. */
  readonly current: boolean;
  readonly onOpen: (id: number) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * A dot between the parts of the line, which a screen reader hears as a
 * comma: text in a button runs together into its name, so it needs one.
 */
function Sep(): JSX.Element {
  return (
    <>
      <span aria-hidden="true">·</span>
      <span className="sr-only">, </span>
    </>
  );
}

/**
 * One story in the list: a button holding its headline and a line with its
 * category (shape and name), place, age and how many outlets cover it, all
 * of which a screen reader reads as the button's name. Opening it shows the
 * same sheet a pin does.
 */
export function StoryListRow(props: StoryListRowProps): JSX.Element {
  const { nodes, row, nowMs, current } = props;
  const id = nodes.ids[row] ?? 0;
  const publishedMs = (nodes.epochSec + (nodes.publishedSec[row] ?? 0)) * 1000;
  const place = nodes.places[row] ?? '';
  const open = nodes.discussionOpen[row] === 1;

  return (
    <li>
      <button
        type="button"
        data-story-id={id}
        aria-current={current ? 'true' : undefined}
        onClick={() => props.onOpen(id)}
        onKeyDown={props.onKeyDown}
        className={`flex w-full flex-col gap-1 rounded-xl px-4 py-3 text-left hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${current ? 'bg-white/10' : ''}`}
      >
        <span className="font-medium leading-snug text-ink">
          {nodes.headlines[row] ?? ''}
          <span className="sr-only">. </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
          <CategoryLabel category={categoryAt(nodes.categories[row] ?? 0)} />
          {place !== '' && <Sep />}
          {place !== '' && <span>{place}</span>}
          <Sep />
          <time dateTime={new Date(publishedMs).toISOString()}>
            {formatAgo(publishedMs, nowMs)}
          </time>
          <Sep />
          <span>{plural(nodes.sourceCounts[row] ?? 0, 'source', 'sources')}</span>
          {open && (
            <>
              <Sep />
              <span className="text-accent">Discussion open</span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}
