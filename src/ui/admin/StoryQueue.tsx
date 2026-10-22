import { useEffect, useRef, type JSX } from 'react';

import type { HotStory } from '@/core/admin';
import type { ConsoleController } from '@/state/adminConsole';
import { useConsoleStore } from '@/state/adminConsoleStore';

import { PRIMARY, SECONDARY } from '../account/accountStyles';
import { formatAgo, sourcesText } from '../story/format';
import { atCap, capText, consoleMessageText } from './adminView';
import { OpenDiscussionForm } from './OpenDiscussionForm';

export interface StoryQueueProps {
  readonly controller: ConsoleController;
  readonly nowMs: number;
}

const LINK = 'text-accent underline underline-offset-2';

/** The place as the story card names it ("New York, United States"); the code alone without one. */
function placeText(story: HotStory): string {
  return story.placeName ?? story.countryCode ?? 'No place';
}

/**
 * The hot story queue: stories the ingest queued, hottest first. "Open
 * discussion…" shows the debate's words under the story at once, and the
 * cap, when reached, is said above the list and holds every Open back.
 */
export function StoryQueue({ controller, nowMs }: StoryQueueProps): JSX.Element {
  const stories = useConsoleStore((state) => state.stories);
  const status = useConsoleStore((state) => state.storiesStatus);
  const form = useConsoleStore((state) => state.form);
  const counters = useConsoleStore((state) => state.counters);
  const message = useConsoleStore((state) => state.message);
  const capped = atCap(counters);
  const openButtons = useRef(new Map<string, HTMLButtonElement>());
  const lastFormStory = useRef<string | null>(null);

  // A closed form hands focus back to its story's button, or to the list's
  // next one when the story opened and left.
  useEffect(() => {
    const was = lastFormStory.current;
    lastFormStory.current = form?.storyId ?? null;
    if (form !== null || was === null) return;
    const button = openButtons.current.get(was) ?? openButtons.current.values().next().value;
    button?.focus();
  }, [form]);

  let list: JSX.Element;
  if (status === 'loading') {
    list = <p className="text-sm text-muted">Loading the queue…</p>;
  } else if (status === 'failed') {
    list = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted">The story queue could not be loaded.</p>
        <button type="button" className={PRIMARY} onClick={() => void controller.refresh()}>
          Try again
        </button>
      </div>
    );
  } else if (stories.length === 0) {
    list = (
      <p className="text-sm text-muted">
        No queued stories. Stories join the queue when their heat crosses the line.
      </p>
    );
  } else {
    list = (
      <ol aria-label="Queued stories, hottest first" className="flex flex-col gap-3">
        {stories.map((story) => {
          const editing = form?.storyId === story.storyId;
          return (
            <li key={story.storyId} className="rounded-lg border border-ink/10 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-ink">{story.title}</h3>
                  <p className="mt-1 text-xs text-muted">
                    {placeText(story)} · {sourcesText(story.sourceCount)} · heat {story.heat} ·{' '}
                    {formatAgo(story.publishedAtMs, nowMs)}
                    {story.locationReports > 0 &&
                      ` · ${story.locationReports} say the pin is in the wrong place`}
                  </p>
                  <a
                    href={`/?story=${story.seq}`}
                    target="_blank"
                    rel="noreferrer"
                    className={`text-xs ${LINK}`}
                  >
                    See it on the globe
                  </a>
                </div>
                {!editing && (
                  <button
                    ref={(element) => {
                      if (element) openButtons.current.set(story.storyId, element);
                      else openButtons.current.delete(story.storyId);
                    }}
                    type="button"
                    className={SECONDARY}
                    disabled={form?.sending === true}
                    aria-label={`Open a discussion on “${story.title}”`}
                    onClick={() => controller.beginOpen(story.storyId)}
                  >
                    Open discussion…
                  </button>
                )}
              </div>
              {editing && form !== null && (
                <OpenDiscussionForm
                  form={form}
                  title={story.title}
                  capped={capped}
                  onEdit={controller.edit}
                  onSuggestAgain={controller.suggestAgain}
                  onCancel={controller.cancel}
                  onConfirm={() => void controller.confirm()}
                />
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      {/* The cap's refusal, when there is one, says this already. */}
      {capped && counters !== null && message?.kind !== 'cap' && (
        <p className="rounded-lg border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-ink">
          {capText(counters.maxOpen, counters.nextCloseAtMs, nowMs)} Words can be prepared; Open
          waits.
        </p>
      )}
      <p role="status" className="min-h-5 text-sm text-ink">
        {message === null ? '' : consoleMessageText(message, nowMs)}
      </p>
      {list}
    </section>
  );
}
