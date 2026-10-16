import { useEffect, useLayoutEffect, useMemo, useRef, type JSX } from 'react';

import type { DbConfig } from '@/core/db/config';
import { wallClockNow } from '@/state';
// Directly, not through the barrel: only this chunk carries the queue.
import {
  createQueueController,
  loadAdminSession,
  queueStore,
  useQueueStore,
} from '@/state/moderationQueue';

import { PRIMARY, QUIET, SECONDARY } from '../account/accountStyles';
import { QueueItemCard } from './QueueItemCard';

export interface AdminAppProps {
  readonly dbConfig: DbConfig | null;
}

const LINK = 'text-accent underline underline-offset-2';

/**
 * /admin (Prompt 4.3; Prompt 4.6 adds its other sections): the moderation
 * queue as a plain, keyboard-first list. Loaded instead of the globe, in its
 * own chunk. The page uses the session made on the globe; the database says
 * whether that account may moderate.
 */
export function AdminApp({ dbConfig }: AdminAppProps): JSX.Element {
  const status = useQueueStore((state) => state.status);
  const handle = useQueueStore((state) => state.handle);
  const items = useQueueStore((state) => state.items);
  const acting = useQueueStore((state) => state.acting);
  const message = useQueueStore((state) => state.message);
  const heading = useRef<HTMLHeadingElement>(null);
  const actedAt = useRef<number | null>(null);
  const controller = useMemo(
    () =>
      dbConfig === null
        ? null
        : createQueueController({ store: queueStore, load: () => loadAdminSession(dbConfig) }),
    [dbConfig],
  );

  useEffect(() => {
    document.title = 'Moderation queue · Global Agora';
    void controller?.start();
  }, [controller]);

  // A decided post leaves the list: focus moves to the one that took its
  // place, or to the page heading when the list is empty.
  useLayoutEffect(() => {
    if (actedAt.current === null || acting !== null) return;
    const headings = document.querySelectorAll<HTMLElement>('[data-queue-heading]');
    const next = headings[Math.min(actedAt.current, headings.length - 1)];
    actedAt.current = null;
    (next ?? heading.current)?.focus();
  }, [items, acting]);

  const nowMs = wallClockNow();

  let content: JSX.Element;
  if (controller === null) {
    content = (
      <p className="text-sm text-muted">This build has no backend, so nothing to moderate.</p>
    );
  } else if (status === 'loading') {
    content = <p className="text-sm text-muted">Loading the queue…</p>;
  } else if (status === 'signed-out') {
    content = (
      <p className="text-sm text-muted">
        Sign in on the{' '}
        <a href="/" className={LINK}>
          globe
        </a>{' '}
        first, then come back here.
      </p>
    );
  } else if (status === 'not-admin') {
    content = <p className="text-sm text-muted">This page is for moderators.</p>;
  } else if (status === 'unreachable') {
    content = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted">The queue could not be loaded.</p>
        <button type="button" className={PRIMARY} onClick={() => void controller.start()}>
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
    <div className="h-full overflow-y-auto bg-void text-ink">
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted">Global Agora · Admin</p>
            <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">
              Moderation queue
              {status === 'ready' && (
                <span className="ml-2 text-sm font-normal text-muted">{items.length} waiting</span>
              )}
            </h1>
            {handle !== null && <p className="text-xs text-muted">Signed in as @{handle}</p>}
          </div>
          <div className="flex gap-2">
            {status === 'ready' && (
              <button
                type="button"
                className={SECONDARY}
                disabled={acting !== null}
                onClick={() => void controller?.refresh()}
              >
                Refresh
              </button>
            )}
            <a href="/" className={`${QUIET} inline-flex items-center`}>
              Back to the globe
            </a>
          </div>
        </header>
        <p role="status" className="min-h-5 text-sm text-ink">
          {message}
        </p>
        {content}
      </main>
    </div>
  );
}
