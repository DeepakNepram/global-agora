import { useEffect, useId, useRef, useState, type JSX } from 'react';

// Directly, not through the barrel: only the /admin chunk carries the console.
import { APPEAL_REPLY_MAX_LENGTH, type AdminAppeal } from '@/core/appeal';

import { DANGER, LABEL, PRIMARY, SECONDARY } from '../account/accountStyles';
import { formatAgoLong } from '../story/format';

const FIELD =
  'w-full rounded-xl border border-edge bg-void px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export interface AppealCardProps {
  readonly appeal: AdminAppeal;
  readonly nowMs: number;
  /** A decision is running here or on another appeal: the buttons wait. */
  readonly busy: boolean;
  onDecide(grant: boolean, reply: string): void;
}

/**
 * One appeal (Prompt 5.2): who, how many strikes, what they wrote and the
 * posts behind the strikes; then Grant or Refuse. Either needs a reply the
 * account will read, and waits for a second press that says what it does.
 */
export function AppealCard({ appeal, nowMs, busy, onDecide }: AppealCardProps): JSX.Element {
  const [reply, setReply] = useState('');
  const [choice, setChoice] = useState<boolean | null>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const pending = appeal.status === 'pending';

  useEffect(() => {
    if (choice !== null) confirm.current?.focus();
  }, [choice]);

  return (
    <article
      aria-labelledby={`${ids}-who`}
      className="flex flex-col gap-3 rounded-xl border border-ink/15 p-4"
    >
      <h3
        id={`${ids}-who`}
        data-appeal-heading
        tabIndex={-1}
        className="text-sm font-semibold text-ink outline-none"
      >
        @{appeal.handle} · {appeal.strikes} {appeal.strikes === 1 ? 'strike' : 'strikes'}
        {appeal.suspended ? ' · suspended' : ''}
      </h3>
      <p className="text-xs text-muted">
        Appealed {formatAgoLong(appeal.createdAtMs, nowMs)}
        {appeal.decidedAtMs !== null &&
          ` · ${appeal.status} ${formatAgoLong(appeal.decidedAtMs, nowMs)}`}
      </p>
      <blockquote className="whitespace-pre-wrap border-l-2 border-accent pl-3 text-sm text-ink">
        {appeal.body}
      </blockquote>
      {appeal.removedPosts.length > 0 && (
        <details className="text-sm text-ink">
          <summary className="cursor-pointer text-muted">
            The {appeal.removedPosts.length} removed{' '}
            {appeal.removedPosts.length === 1 ? 'post' : 'posts'} behind the strikes
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {appeal.removedPosts.map((post) => (
              <li key={`${post.createdAtMs}-${post.body}`} className="rounded-lg bg-white/5 p-2">
                {post.body}
              </li>
            ))}
          </ul>
        </details>
      )}
      {appeal.reply !== null && <p className="text-sm text-muted">Reply: “{appeal.reply}”</p>}

      {pending && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-reply`} className={LABEL}>
            Reply to @{appeal.handle} (they will read it)
          </label>
          <textarea
            id={`${ids}-reply`}
            rows={3}
            maxLength={APPEAL_REPLY_MAX_LENGTH}
            value={reply}
            onChange={(event) => {
              setReply(event.currentTarget.value);
              setChoice(null);
            }}
            className={FIELD}
          />
          {choice === null ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={SECONDARY}
                aria-disabled={busy || reply.trim() === ''}
                onClick={() => !busy && reply.trim() !== '' && setChoice(true)}
              >
                Grant…
              </button>
              <button
                type="button"
                className={SECONDARY}
                aria-disabled={busy || reply.trim() === ''}
                onClick={() => !busy && reply.trim() !== '' && setChoice(false)}
              >
                Refuse…
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink">
                {choice
                  ? 'Granting ends the suspension, and its strikes stop counting. The removed posts stay removed.'
                  : 'Refusing keeps the suspension; they can appeal again after the wait.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  ref={confirm}
                  type="button"
                  className={choice ? PRIMARY : DANGER}
                  aria-busy={busy}
                  onClick={() => onDecide(choice, reply)}
                >
                  {choice ? 'Grant the appeal' : 'Refuse the appeal'}
                </button>
                <button type="button" className={SECONDARY} onClick={() => setChoice(null)}>
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
