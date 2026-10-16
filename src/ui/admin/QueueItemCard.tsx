import { useEffect, useRef, useState, type JSX } from 'react';

import {
  QUEUED_FOR_LABEL,
  reportSummary,
  strikeConsequence,
  type ModerationAction,
  type QueueItem,
} from '@/core/moderationQueue';

import { DANGER, PRIMARY, SECONDARY } from '../account/accountStyles';
import { formatAgoLong } from '../story/format';

export interface QueueItemCardProps {
  readonly item: QueueItem;
  readonly nowMs: number;
  /** An action is running here or on another post: the buttons wait. */
  readonly busy: boolean;
  readonly acting: boolean;
  onAct(action: ModerationAction): void;
}

function kindLabel(kind: string): string {
  if (kind === 'expert') return 'Expert (self-declared, unverified)';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * One queued post: why it is here, what it says, who wrote it and what the
 * models made of it, then approve / remove / strike. Strike says what it
 * will do (a suspension, perhaps) and waits for a second press.
 */
export function QueueItemCard({
  item,
  nowMs,
  busy,
  acting,
  onAct,
}: QueueItemCardProps): JSX.Element {
  const [confirmingStrike, setConfirmingStrike] = useState(false);
  const strikeButton = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);

  // Cancelling unmounts the focused button: focus goes back to Strike.
  useEffect(() => {
    if (!confirmingStrike && cancelled.current) {
      cancelled.current = false;
      strikeButton.current?.focus();
    }
  }, [confirmingStrike]);
  const headingId = `queued-${item.postId}`;
  const models =
    item.toxicity === null
      ? 'No answer from the models.'
      : `Toxic ${item.toxicity.toFixed(2)}` +
        (item.flagged.length > 0 ? `; flagged: ${item.flagged.join(', ')}` : '; nothing flagged');

  return (
    <article
      aria-labelledby={headingId}
      aria-busy={acting}
      className="flex flex-col gap-3 rounded-2xl border border-ink/15 bg-panel p-4"
    >
      <h2
        id={headingId}
        data-queue-heading
        tabIndex={-1}
        className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-ink outline-none"
      >
        <span>{QUEUED_FOR_LABEL[item.queuedFor]}</span>
        <span className="text-xs font-normal text-muted">
          waiting since {formatAgoLong(item.waitingSinceMs, nowMs).toLowerCase()}
        </span>
      </h2>
      <p className="text-xs text-muted">
        In “{item.prompt}” · {item.sideLabel} · {kindLabel(item.kind)}
      </p>
      <p className="whitespace-pre-wrap break-words rounded-xl bg-void px-3 py-2 text-sm text-ink">
        {item.body}
      </p>
      {item.evidenceUrl !== null && (
        <p className="break-all text-xs text-muted">
          Evidence:{' '}
          <a
            href={item.evidenceUrl}
            target="_blank"
            rel="noreferrer nofollow"
            className="text-accent underline underline-offset-2"
          >
            {item.evidenceUrl}
          </a>
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Author</dt>
        <dd className="text-ink">
          @{item.authorHandle} · {item.authorStrikes}{' '}
          {item.authorStrikes === 1 ? 'strike' : 'strikes'}
          {item.authorSuspended ? ' · suspended' : ''}
        </dd>
        {item.reportCount > 0 && (
          <>
            <dt className="text-muted">Reports</dt>
            <dd className="text-ink">{reportSummary(item.reportReasons)}</dd>
          </>
        )}
        <dt className="text-muted">Models</dt>
        <dd className="text-ink">{models}</dd>
      </dl>

      {confirmingStrike ? (
        <div role="group" aria-label="Confirm the strike" className="flex flex-col gap-2">
          <p className="text-sm text-ink">
            Remove the post and give a strike? {strikeConsequence(item)}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={SECONDARY}
              disabled={busy}
              // The safe choice takes focus, as in the account deletion.
              autoFocus
              onClick={() => {
                cancelled.current = true;
                setConfirmingStrike(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={DANGER}
              disabled={busy}
              onClick={() => onAct('strike')}
            >
              {acting ? 'Striking…' : 'Remove and strike'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={PRIMARY}
            disabled={busy}
            aria-describedby={headingId}
            onClick={() => onAct('approve')}
          >
            Approve
          </button>
          <button
            type="button"
            className={SECONDARY}
            disabled={busy}
            aria-describedby={headingId}
            onClick={() => onAct('remove')}
          >
            Remove
          </button>
          <button
            ref={strikeButton}
            type="button"
            className={SECONDARY}
            disabled={busy}
            aria-describedby={headingId}
            onClick={() => setConfirmingStrike(true)}
          >
            Strike…
          </button>
        </div>
      )}
    </article>
  );
}
