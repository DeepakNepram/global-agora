import { useEffect, useLayoutEffect, useRef, type JSX } from 'react';

import { useQueueStore, type QueueController } from '@/state/moderationQueue';

import { PRIMARY } from '../account/accountStyles';
import { QueueItemCard } from './QueueItemCard';

export interface ModerationTabProps {
  readonly controller: QueueController;
  readonly nowMs: number;
}

/**
 * Prompt 4.3's moderation queue, as a tab of the console: held, reported and
 * unchecked posts, longest waiting first, with approve / remove / strike.
 * The console's arrival check already decided this account is an admin.
 */
export function ModerationTab({ controller, nowMs }: ModerationTabProps): JSX.Element {
  const status = useQueueStore((state) => state.status);
  const items = useQueueStore((state) => state.items);
  const acting = useQueueStore((state) => state.acting);
  const message = useQueueStore((state) => state.message);
  const heading = useRef<HTMLHeadingElement>(null);
  const actedAt = useRef<number | null>(null);

  useEffect(() => {
    void controller.refresh();
  }, [controller]);

  // A decided post leaves the list: focus moves to the one that took its
  // place, or to the tab's heading when the list is empty.
  useLayoutEffect(() => {
    if (actedAt.current === null || acting !== null) return;
    const headings = document.querySelectorAll<HTMLElement>('[data-queue-heading]');
    const next = headings[Math.min(actedAt.current, headings.length - 1)];
    actedAt.current = null;
    (next ?? heading.current)?.focus();
  }, [items, acting]);

  let content: JSX.Element;
  if (status === 'loading') {
    content = <p className="text-sm text-muted">Loading the queue…</p>;
  } else if (status === 'unreachable' || status === 'not-admin' || status === 'signed-out') {
    content = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted">The queue could not be loaded.</p>
        <button type="button" className={PRIMARY} onClick={() => void controller.refresh()}>
          Try again
        </button>
      </div>
    );
  } else if (items.length === 0) {
    content = (
      <p className="text-sm text-muted">
        Nothing waiting. Held, reported and unchecked posts appear here.
      </p>
    );
  } else {
    content = (
      <ol aria-label="Posts waiting" className="flex flex-col gap-3">
        {items.map((item, index) => (
          <li key={item.postId}>
            <QueueItemCard
              item={item}
              nowMs={nowMs}
              busy={acting !== null}
              acting={acting === item.postId}
              onAct={(action) => {
                actedAt.current = index;
                void controller.act(item.postId, action);
              }}
            />
          </li>
        ))}
      </ol>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 ref={heading} tabIndex={-1} className="sr-only">
        Posts waiting for a moderator
      </h2>
      <p role="status" className="min-h-5 text-sm text-ink">
        {message}
      </p>
      {content}
    </section>
  );
}
