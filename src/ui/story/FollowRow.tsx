import { useMemo, type JSX } from 'react';

import { followKey, type NodeBuffer } from '@/core';
import { followsStore, useFollowsStore } from '@/state';

import { placesData, useLazy } from '../data/lazyData';
import { storyFollows } from '../library/followInputs';

export interface FollowRowProps {
  readonly nodes: NodeBuffer;
  readonly row: number;
  /** The sheet is drawn up: worth loading the gazetteer for the story's city and country. */
  readonly expanded: boolean;
  readonly announce: (text: string) => void;
}

const CHIP =
  'flex h-9 max-w-full items-center gap-1.5 rounded-full border px-3 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * Follow, from a story: the story itself, its city, its country and its
 * category, each a toggle. The city and country appear once the gazetteer
 * has loaded (on drawing the sheet up), so a peek costs nothing extra.
 */
export function FollowRow({ nodes, row, expanded, announce }: FollowRowProps): JSX.Element {
  const places = useLazy(placesData, expanded);
  const follows = useFollowsStore((state) => state.follows);
  const options = useMemo(() => storyFollows(nodes, row, places.value), [nodes, row, places.value]);
  const followed = new Set(follows.map(followKey));

  return (
    <section aria-labelledby="story-follow" className="flex flex-col gap-2">
      <h3 id="story-follow" className="text-xs font-semibold uppercase tracking-wide text-muted">
        Follow
      </h3>
      <div role="group" aria-labelledby="story-follow" className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = followed.has(followKey(option));
          const label = option.kind === 'story' ? 'This story' : option.label;
          return (
            <button
              key={followKey(option)}
              type="button"
              aria-pressed={on}
              onClick={() => {
                const result = followsStore.getState().toggle(option);
                announce(
                  `${result === 'followed' ? 'Following' : 'Unfollowed'} ${option.kind === 'story' ? 'this story' : option.label}.`,
                );
              }}
              className={
                on
                  ? `${CHIP} border-accent bg-accent/15 text-accent`
                  : `${CHIP} border-ink/25 text-ink hover:bg-white/10`
              }
            >
              <span aria-hidden="true">{on ? '✓' : '+'}</span>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
