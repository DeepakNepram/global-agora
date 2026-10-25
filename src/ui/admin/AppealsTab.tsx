import { useEffect, useLayoutEffect, useRef, type JSX } from 'react';

import { useAppealsStore, type AppealsController } from '@/state/adminAppeals';

import { PRIMARY } from '../account/accountStyles';
import { AppealCard } from './AppealCard';

/**
 * Suspended accounts' appeals (Prompt 5.2): waiting ones first, oldest
 * first, then the latest decided. A decision moves focus to the next card's
 * heading, or to the tab's heading when none is left.
 */
export function AppealsTab({
  controller,
  nowMs,
}: {
  readonly controller: AppealsController;
  readonly nowMs: number;
}): JSX.Element {
  const status = useAppealsStore((state) => state.status);
  const items = useAppealsStore((state) => state.items);
  const deciding = useAppealsStore((state) => state.deciding);
  const message = useAppealsStore((state) => state.message);
  const heading = useRef<HTMLHeadingElement>(null);
  const decidedAt = useRef<number | null>(null);

  useEffect(() => {
    void controller.load();
  }, [controller]);

  useLayoutEffect(() => {
    if (decidedAt.current === null || deciding !== null) return;
    const headings = document.querySelectorAll<HTMLElement>('[data-appeal-heading]');
    const next = headings[Math.min(decidedAt.current, headings.length - 1)];
    decidedAt.current = null;
    (next ?? heading.current)?.focus();
  }, [items, deciding]);

  let content: JSX.Element;
  if (status === 'idle' || status === 'loading') {
    content = <p className="text-sm text-muted">Loading the appeals…</p>;
  } else if (status === 'failed') {
    content = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted">The appeals could not be loaded.</p>
        <button type="button" className={PRIMARY} onClick={() => void controller.load()}>
          Try again
        </button>
      </div>
    );
  } else if (items.length === 0) {
    content = (
      <p className="text-sm text-muted">No appeals. A suspended account’s appeal appears here.</p>
    );
  } else {
    content = (
      <ol aria-label="Appeals" className="flex flex-col gap-3">
        {items.map((appeal, index) => (
          <li key={appeal.id}>
            <AppealCard
              appeal={appeal}
              nowMs={nowMs}
              busy={deciding !== null}
              onDecide={(grant, reply) => {
                decidedAt.current = index;
                void controller.decide(appeal.id, grant, reply);
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
        Appeals from suspended accounts
      </h2>
      <p role="status" className="min-h-5 text-sm text-ink">
        {message}
      </p>
      {content}
    </section>
  );
}
