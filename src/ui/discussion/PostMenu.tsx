import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
} from 'react';

import { REPORT_REASONS, type ReportReason } from '@/core/moderation';
import type { ModerationResult } from '@/state/discussionRoomActions';
import { DiscussionDocLink } from './DiscussionDocLink';

const RULES_LINK =
  'text-accent underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

export interface PostMenuProps {
  readonly handle: string | null;
  readonly onReport: (reason: ReportReason) => Promise<ModerationResult>;
  readonly onBlock: () => Promise<ModerationResult>;
  readonly announce: (text: string) => void;
}

type View = 'closed' | 'menu' | 'report' | 'block';

const ITEM =
  'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-ink hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const BUTTON =
  'h-11 rounded-full px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const REPORT_TEXT: Readonly<Record<ModerationResult, string>> = {
  ok: 'Thanks. A moderator will look at it, and your updates will say what happened.',
  already: 'You reported this post already.',
  gone: 'This post is no longer there.',
  'signed-out': 'Sign in to report a post.',
  failed: 'The report could not be sent. Try again.',
};

/**
 * Report and Block for a post (Prompt 4.3's tools, placed here by 4.5):
 * a menu under ⋯, then the six reasons, or a confirmation before a block,
 * which hides that account's posts from you and yours from them. Escape
 * steps back without leaving the discussion, and the menu closes when
 * focus leaves it (Tab past its end, a click elsewhere), so it never sits
 * open behind the keyboard (Prompt 5.1).
 */
export function PostMenu({ handle, onReport, onBlock, announce }: PostMenuProps): JSX.Element {
  const [view, setView] = useState<View>('closed');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement | HTMLInputElement | null>(null);
  const who = handle ? `@${handle}` : 'this account';

  useEffect(() => {
    if (view !== 'closed') first.current?.focus();
  }, [view]);

  const close = (): void => {
    setView('closed');
    setReason(null);
    toggle.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || view === 'closed') return;
    // Handled here: the panel's own Escape would leave the discussion.
    event.preventDefault();
    close();
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (view === 'closed' || busy) return;
    const next = event.relatedTarget;
    // Focus moving within the menu, or to nothing (a click on its padding), keeps it open.
    if (next === null || event.currentTarget.contains(next)) return;
    setView('closed');
    setReason(null);
  };

  const report = async (): Promise<void> => {
    if (reason === null || busy) return;
    setBusy(true);
    const result = await onReport(reason);
    setBusy(false);
    announce(REPORT_TEXT[result]);
    close();
  };

  const block = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const result = await onBlock();
    setBusy(false);
    announce(
      result === 'ok'
        ? `Blocked ${who}. You will not see each other's posts. Unblock from your account.`
        : result === 'signed-out'
          ? 'Sign in to block an account.'
          : 'The block did not go through. Try again.',
    );
    if (result !== 'ok') close();
  };

  return (
    <div onKeyDown={onKeyDown} onBlur={onBlur} className="relative">
      <button
        ref={toggle}
        type="button"
        aria-expanded={view !== 'closed'}
        aria-controls={`${ids}-menu`}
        aria-label={`More for ${who}'s post`}
        onClick={() => (view === 'closed' ? setView('menu') : close())}
        className="grid size-11 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-current">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>

      {view !== 'closed' && (
        <div
          id={`${ids}-menu`}
          className="absolute right-0 z-10 mt-1 w-72 max-w-[80vw] rounded-xl border border-ink/15 bg-panel p-2 shadow-[0_8px_30px_rgb(0_0_0/0.6)]"
        >
          {view === 'menu' && (
            <ul className="flex flex-col">
              <li>
                <button
                  ref={(el) => void (first.current = el)}
                  type="button"
                  className={ITEM}
                  onClick={() => setView('report')}
                >
                  Report post…
                </button>
              </li>
              <li>
                <button type="button" className={ITEM} onClick={() => setView('block')}>
                  Block {who}…
                </button>
              </li>
            </ul>
          )}

          {view === 'report' && (
            <fieldset className="flex flex-col gap-1 p-1">
              <legend className="mb-1 text-sm font-semibold text-ink">Why report this post?</legend>
              {REPORT_REASONS.map((option, index) => (
                <label
                  key={option.id}
                  className="flex min-h-11 items-center gap-3 text-sm text-ink"
                >
                  <input
                    ref={index === 0 ? (el) => void (first.current = el) : undefined}
                    type="radio"
                    name={`${ids}-reason`}
                    checked={reason === option.id}
                    onChange={() => setReason(option.id)}
                    className="size-4 accent-accent"
                  />
                  {option.label}
                </label>
              ))}
              <p className="text-xs text-muted">
                What breaks them: the{' '}
                <DiscussionDocLink doc="rules" className={RULES_LINK}>
                  community rules
                </DiscussionDocLink>
                .
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={`${BUTTON} border border-ink/20 text-ink`}
                  onClick={close}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  aria-disabled={reason === null}
                  aria-busy={busy}
                  className={`${BUTTON} ${reason === null ? 'bg-ink/10 text-muted' : 'bg-accent text-void'}`}
                  onClick={() => void report()}
                >
                  Send report
                </button>
              </div>
            </fieldset>
          )}

          {view === 'block' && (
            <div role="group" aria-labelledby={`${ids}-block`} className="flex flex-col gap-2 p-1">
              <p id={`${ids}-block`} className="text-sm text-ink">
                Block {who}? You will not see each other's posts anywhere. You can unblock from your
                account.
              </p>
              <div className="flex gap-2">
                <button
                  ref={(el) => void (first.current = el)}
                  type="button"
                  className={`${BUTTON} border border-ink/20 text-ink`}
                  onClick={close}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  aria-busy={busy}
                  className={`${BUTTON} bg-red-400 text-void`}
                  onClick={() => void block()}
                >
                  Block
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
