import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';

import { APPEAL_MAX_LENGTH, appealStanding, type Profile } from '@/core';
import { getAccountController, useAccountStore, wallClockNow } from '@/state';

import { DocLink } from '../legal/DocLink';
import { BODY, LABEL, PRIMARY, QUIET, SECONDARY } from './accountStyles';

const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' });

const FIELD =
  'w-full rounded-xl border border-edge bg-void px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * Under a suspension notice (Prompt 5.2): "Appeal this suspension" and its
 * form, or where the appeal stands: waiting for a moderator, or refused with
 * the date another may be sent. A granted appeal ends the suspension, and
 * this with it; the reply is in the updates.
 */
export function AppealSection({ profile }: { readonly profile: Profile }): JSX.Element | null {
  const busy = useAccountStore((state) => state.busy);
  const [writing, setWriting] = useState(false);
  const [body, setBody] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const sent = useRef<HTMLParagraphElement>(null);
  const justSent = useRef(false);
  const ids = useId();
  const standing = appealStanding(profile.suspendedAtMs, profile.appeal, wallClockNow());

  useEffect(() => {
    if (writing) field.current?.focus();
  }, [writing]);

  // Sent: focus moves to the line that says so.
  useEffect(() => {
    if (standing.kind === 'pending' && justSent.current) {
      justSent.current = false;
      sent.current?.focus();
    }
  }, [standing.kind]);

  if (standing.kind === 'none') return null;

  if (standing.kind === 'pending') {
    return (
      <p ref={sent} tabIndex={-1} className={`${BODY} outline-none`}>
        You appealed on {DAY.format(standing.sentAtMs)}. A moderator will read it and reply in your
        updates.
      </p>
    );
  }

  if (standing.kind === 'wait') {
    return (
      <p className={BODY}>
        Your appeal was refused
        {standing.reply ? <>: “{standing.reply}”</> : '.'} You can appeal again on{' '}
        {DAY.format(standing.againAtMs)}.
      </p>
    );
  }

  const cancel = (): void => {
    setWriting(false);
    // After the form goes, the button that opened it is back.
    window.setTimeout(() => start.current?.focus(), 0);
  };

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const controller = getAccountController();
    if (busy || controller === null || body.trim() === '') return;
    justSent.current = true;
    if (await controller.sendAppeal(body)) {
      setBody('');
      setWriting(false);
    } else {
      justSent.current = false;
    }
  };

  if (!writing) {
    return (
      <div className="flex flex-col items-start gap-2">
        {standing.refusedReply !== null && (
          <p className={BODY}>Your last appeal was refused: “{standing.refusedReply}”</p>
        )}
        <button ref={start} type="button" className={SECONDARY} onClick={() => setWriting(true)}>
          Appeal this suspension
        </button>
      </div>
    );
  }

  const left = APPEAL_MAX_LENGTH - body.length;
  return (
    <form onSubmit={(event) => void send(event)} className="flex flex-col gap-2">
      <label htmlFor={`${ids}-appeal`} className={LABEL}>
        Why should the suspension end?
      </label>
      <textarea
        ref={field}
        id={`${ids}-appeal`}
        rows={5}
        maxLength={APPEAL_MAX_LENGTH}
        value={body}
        onChange={(event) => setBody(event.currentTarget.value)}
        aria-describedby={`${ids}-note`}
        className={FIELD}
      />
      <p id={`${ids}-note`} className="text-xs text-muted">
        {left} characters left. A person reads every appeal.{' '}
        <DocLink doc="rules" section="appeals">
          How appeals work
        </DocLink>
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} aria-busy={busy}>
          {busy ? 'Sending…' : 'Send appeal'}
        </button>
        <button type="button" className={QUIET} onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
