import type { JSX } from 'react';

import { describeNotice, type AppNotice } from '@/core';
import { getUpdatesController, useUpdatesStore, wallClockNow } from '@/state';

import { formatAgoLong } from '../story/format';

function Notice({ notice, nowMs }: { notice: AppNotice; nowMs: number }): JSX.Element {
  const text = describeNotice(notice);
  const fresh = notice.readAtMs === null;
  return (
    <li className="flex flex-col gap-1 border-t border-ink/10 py-3 first:border-t-0">
      <p className="flex items-baseline justify-between gap-3 text-sm text-ink">
        <span className="font-medium">
          {fresh && (
            <span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full bg-accent" />
          )}
          {text.title}
          {fresh && <span className="sr-only"> (new)</span>}
        </span>
        <span className="shrink-0 text-xs text-muted">
          {formatAgoLong(notice.createdAtMs, nowMs)}
        </span>
      </p>
      <p className="text-sm text-muted">{text.body}</p>
      {text.help !== undefined && (
        <a
          href={text.help.href}
          target="_blank"
          rel="noreferrer"
          className="self-start text-sm font-medium text-accent underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {text.help.label}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </li>
  );
}

/**
 * The account sheet's Updates (Prompt 4.3): the outcome of the reader's
 * reports and any removal of their posts. Showing them marks them read.
 */
export function UpdatesList(): JSX.Element {
  const notices = useUpdatesStore((state) => state.notices);
  const loading = useUpdatesStore((state) => state.loading);
  const failed = useUpdatesStore((state) => state.failed);
  const nowMs = wallClockNow();

  let content: JSX.Element;
  if (failed) {
    content = (
      <p className="text-sm text-muted">
        Updates could not be loaded.{' '}
        <button
          type="button"
          className="font-medium text-accent underline underline-offset-2"
          onClick={() => void getUpdatesController()?.show()}
        >
          Try again
        </button>
      </p>
    );
  } else if (notices === null) {
    content = <p className="text-sm text-muted">{loading ? 'Loading…' : ''}</p>;
  } else if (notices.length === 0) {
    content = (
      <p className="text-sm text-muted">
        Nothing yet. When you report a post, you will hear the outcome here.
      </p>
    );
  } else {
    content = (
      <ul aria-label="Updates" className="flex flex-col">
        {notices.map((notice) => (
          <Notice key={notice.id} notice={notice} nowMs={nowMs} />
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby="updates-heading" className="flex flex-col gap-2">
      <h3 id="updates-heading" className="text-sm font-semibold text-ink">
        Updates
      </h3>
      {content}
    </section>
  );
}
