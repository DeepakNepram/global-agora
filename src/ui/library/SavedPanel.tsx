import type { JSX } from 'react';

import { savedStore, useLibraryStatus, useSavedStore, wallClockNow } from '@/state';

import { formatAgo } from '../story/format';

export interface SavedPanelProps {
  /** AppConfig.savedStoryLimit: a tier boundary. */
  readonly limit: number;
  readonly onOpenStory: (id: number) => void;
  readonly announce: (text: string) => void;
}

const ACTION =
  'h-9 shrink-0 rounded-full border px-3 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * The Saved tab: saves newest first, each a snapshot that still says what
 * the story was after it leaves the globe (stories last 48 h). Opening one
 * past that shows the sheet's "no longer available".
 */
export function SavedPanel({ limit, onOpenStory, announce }: SavedPanelProps): JSX.Element {
  const stories = useSavedStore((state) => state.stories);
  const inAccount = useLibraryStatus((state) => state.mode === 'account');
  const nowMs = wallClockNow();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        {stories.length} of {limit} saved, {inAccount ? 'in your account' : 'on this device'}.
      </p>
      {stories.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing saved yet. Save a story from its card to come back to it here.
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {stories.map((story) => (
            <li
              key={story.id}
              className="flex items-start gap-2 rounded-xl px-3 py-2.5 hover:bg-white/5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{story.headline}</p>
                <p className="text-xs text-muted">
                  {[story.place, formatAgo(story.publishedAtMs, nowMs)]
                    .filter((part) => part !== '')
                    .join(' · ')}
                  {' · '}saved {formatAgo(story.savedAtMs, nowMs).toLowerCase()}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Open ${story.headline}`}
                onClick={() => onOpenStory(story.id)}
                className={`${ACTION} border-ink/25 text-ink hover:bg-white/10`}
              >
                Open
              </button>
              <button
                type="button"
                aria-label={`Remove ${story.headline} from saved`}
                onClick={() => {
                  savedStore.getState().remove(story.id);
                  announce('Removed from saved.');
                }}
                className={`${ACTION} border-transparent text-muted hover:text-ink`}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
