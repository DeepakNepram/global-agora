import { useMemo, type JSX } from 'react';

import {
  buildFeed,
  categoryAt,
  reasonText,
  CATEGORY_LABELS,
  NEWS_CATEGORIES,
  type NodeBuffer,
} from '@/core';
import { followsStore, useFollowsStore, wallClockNow } from '@/state';

import { placesData, useLazy } from '../data/lazyData';
import { formatAgo } from '../story/format';
import { categoryFollow, placeFollow } from './followInputs';
import { PlacePicker } from './PlacePicker';

export interface FollowingPanelProps {
  readonly nodes: NodeBuffer | null;
  /** AppConfig.historyWindowHours: how far back the feed reaches. */
  readonly historyHours: number;
  readonly onOpenStory: (id: number) => void;
  readonly announce: (text: string) => void;
}

const CHIP =
  'flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * The Following tab (Prompt 3.4): what you follow, how to follow more, and
 * the feed. The app's one conventional feed: chronological and finite, the
 * window's matching stories and then an end, with no paging and no
 * infinite scroll.
 */
export function FollowingPanel(props: FollowingPanelProps): JSX.Element {
  const { nodes, historyHours, onOpenStory, announce } = props;
  const follows = useFollowsStore((state) => state.follows);
  const places = useLazy(placesData, true);
  const feed = useMemo(
    () => (nodes ? buildFeed(nodes, follows, places.value) : null),
    [nodes, follows, places.value],
  );
  const nowMs = wallClockNow();
  const store = followsStore.getState();

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="following-yours">
        <h3 id="following-yours" className="mb-2 text-sm font-semibold text-ink">
          You follow
        </h3>
        {follows.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing yet. Follow places, topics or single stories, and their news collects here.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {follows.map((follow) => (
              <li key={`${follow.kind}:${follow.target}`}>
                <button
                  type="button"
                  onClick={() => {
                    store.remove(follow.kind, follow.target);
                    announce(`Unfollowed ${follow.label}.`);
                  }}
                  aria-label={`Unfollow ${follow.label}`}
                  className={`${CHIP} max-w-64 border-ink/25 text-ink hover:bg-white/10`}
                >
                  <span className="truncate">{follow.label}</span>
                  <span aria-hidden="true" className="text-muted">
                    ×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="following-topics" className="flex flex-col gap-3">
        <h3 id="following-topics" className="text-sm font-semibold text-ink">
          Follow topics and places
        </h3>
        <div role="group" aria-label="Topics" className="flex flex-wrap gap-1.5">
          {NEWS_CATEGORIES.map((category) => {
            const on = follows.some((f) => f.kind === 'category' && f.target === category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const result = store.toggle(categoryFollow(category));
                  announce(
                    `${result === 'followed' ? 'Following' : 'Unfollowed'} ${CATEGORY_LABELS[category]}.`,
                  );
                }}
                className={
                  on
                    ? `${CHIP} border-ink/60 bg-ink text-void`
                    : `${CHIP} border-ink/20 text-ink hover:bg-white/10`
                }
              >
                {CATEGORY_LABELS[category]}
              </button>
            );
          })}
        </div>
        <PlacePicker
          label="Follow a place"
          placeholder="A city or a country"
          onChoose={(place) => {
            const follow = placeFollow(place);
            if (!follow) return;
            const result = store.toggle(follow);
            announce(`${result === 'followed' ? 'Following' : 'Unfollowed'} ${follow.label}.`);
          }}
        />
      </section>

      <section aria-labelledby="following-feed">
        <h3 id="following-feed" className="mb-2 text-sm font-semibold text-ink">
          Latest from what you follow
        </h3>
        {feed?.waitingForPlaces && <p className="mb-2 text-xs text-muted">Loading places…</p>}
        {nodes && feed && feed.items.length > 0 && (
          <ol className="flex flex-col">
            {feed.items.map((item) => {
              const row = item.row;
              const publishedMs = (nodes.epochSec + (nodes.publishedSec[row] ?? 0)) * 1000;
              const meta = [
                nodes.places[row],
                formatAgo(publishedMs, nowMs),
                CATEGORY_LABELS[categoryAt(nodes.categories[row] ?? 0)],
              ].filter((part) => part !== undefined && part !== '');
              return (
                <li
                  key={item.id}
                  className="[contain-intrinsic-size:auto_88px] [content-visibility:auto]"
                >
                  <button
                    type="button"
                    onClick={() => onOpenStory(item.id)}
                    className="w-full rounded-xl px-3 py-2.5 text-left hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="block text-sm font-medium text-ink">
                      {nodes.headlines[row]}
                    </span>
                    <span className="block text-xs text-muted">{meta.join(' · ')}</span>
                    <span className="block text-xs text-ink/70">
                      Because you follow {reasonText(item.reasons)}
                      {item.sourcesGained !== null && item.sourcesGained > 0
                        ? ` · ${item.sourcesGained} more source${item.sourcesGained === 1 ? '' : 's'} since you followed`
                        : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-3 border-t border-ink/10 pt-3 text-xs text-muted">
          {feed && feed.items.length > 0
            ? `That's everything from the last ${historyHours} hours.`
            : `Nothing from the last ${historyHours} hours matches what you follow.`}
        </p>
      </section>
    </div>
  );
}
