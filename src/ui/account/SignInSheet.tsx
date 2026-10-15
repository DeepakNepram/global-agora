import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';

import type { AuthProvider, OAuthProvider } from '@/core';
import { accountStore, getAccountController, useAccountStore, wallClockNow } from '@/state';

import { ModalSheet } from '../sheets/ModalSheet';
import { accountButtonElement } from './accountFocus';
import { BODY, HEADING, INPUT, LABEL, PRIMARY, QUIET, SECONDARY } from './accountStyles';

export interface SignInSheetProps {
  readonly providers: readonly AuthProvider[];
  readonly reducedMotion: boolean;
}

/** A new link can be asked for this long after the last one (the server allows one a minute). */
const RESEND_AFTER_SECONDS = 60;

const PROVIDER_NAMES: Readonly<Record<OAuthProvider, string>> = {
  google: 'Google',
  apple: 'Apple',
};

const WHY =
  'Keep your follows and saves on every device, and join discussions. Reading never needs an account.';

function secondsUntilResend(sentAtMs: number | null): number {
  if (sentAtMs === null) return 0;
  return Math.max(0, Math.ceil(RESEND_AFTER_SECONDS - (wallClockNow() - sentAtMs) / 1000));
}

/** Seconds until another link may be sent, ticking while it counts down. */
function useResendWait(sentAtMs: number | null): number {
  const [wait, setWait] = useState(() => secondsUntilResend(sentAtMs));
  useEffect(() => {
    setWait(secondsUntilResend(sentAtMs));
    if (sentAtMs === null) return;
    const timer = window.setInterval(() => {
      const next = secondsUntilResend(sentAtMs);
      setWait(next);
      if (next === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sentAtMs]);
  return wait;
}

/**
 * Sign in (Prompt 4.1): Google and Apple when this build offers them, and an
 * emailed link that also carries a 6-digit code. The code is for a phone
 * whose mail app opens links in its own browser, which would otherwise sign
 * in the wrong one.
 */
export function SignInSheet({ providers, reducedMotion }: SignInSheetProps): JSX.Element {
  const open = useAccountStore((state) => state.sheet === 'sign-in');
  const status = useAccountStore((state) => state.status);
  const sentTo = useAccountStore((state) => state.sentTo);
  const sentAtMs = useAccountStore((state) => state.sentAtMs);
  const notice = useAccountStore((state) => state.notice);
  const busy = useAccountStore((state) => state.busy);
  const reason = useAccountStore((state) => state.reason);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const emailId = useId();
  const codeId = useId();
  const noticeId = useId();
  const wait = useResendWait(sentAtMs);
  const controller = getAccountController();
  const signingIn = status === 'loading';
  const oauth = providers.filter((p): p is OAuthProvider => p !== 'email');

  const sendLink = (to: string): void => {
    if (busy || controller === null || to.trim() === '') return;
    setCode('');
    void controller.sendEmailLink(to);
  };

  const checkCode = (event: FormEvent): void => {
    event.preventDefault();
    if (busy || controller === null || code.trim() === '') return;
    void controller.verifyEmailCode(code);
  };

  const otherEmail = (): void =>
    accountStore.setState({ sentTo: null, sentAtMs: null, notice: null });
  const close = (): void => accountStore.getState().closeSheet();

  return (
    <ModalSheet
      open={open}
      titleId="sign-in-title"
      heading={heading}
      focusKey={sentTo === null ? 'email' : 'code'}
      reducedMotion={reducedMotion}
      fallbackFocus={accountButtonElement}
      onDismiss={close}
      header={
        <>
          <p className="text-xs text-muted">Account</p>
          <button type="button" className={QUIET} onClick={close}>
            Close
          </button>
        </>
      }
    >
      <h2 id="sign-in-title" ref={heading} tabIndex={-1} className={HEADING}>
        {sentTo === null ? 'Sign in to Global Agora' : 'Check your email'}
      </h2>

      {sentTo === null ? (
        <>
          <p className={BODY}>{reason ?? WHY}</p>
          {oauth.map((provider) => (
            <button
              key={provider}
              type="button"
              className={SECONDARY}
              aria-describedby={noticeId}
              onClick={() => void controller?.startOAuth(provider)}
            >
              Continue with {PROVIDER_NAMES[provider]}
            </button>
          ))}
          {providers.includes('email') && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                sendLink(email);
              }}
              className="flex flex-col gap-3"
            >
              <div>
                <label htmlFor={emailId} className={LABEL}>
                  Email
                </label>
                <input
                  id={emailId}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  aria-describedby={noticeId}
                  className={INPUT}
                />
              </div>
              <button type="submit" className={`${PRIMARY} self-start`} aria-busy={busy}>
                {busy ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>
          )}
        </>
      ) : (
        <>
          <p className={BODY}>
            We sent a link and a 6-digit code to <span className="text-ink">{sentTo}</span>. Open
            the link in this browser, or type the code here.
          </p>
          <form onSubmit={checkCode} className="flex flex-col gap-3">
            <div>
              <label htmlFor={codeId} className={LABEL}>
                6-digit code
              </label>
              <input
                id={codeId}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                required
                value={code}
                onChange={(event) => setCode(event.currentTarget.value)}
                aria-describedby={noticeId}
                className={`${INPUT} max-w-40 tracking-[0.3em]`}
              />
            </div>
            <button type="submit" className={`${PRIMARY} self-start`} aria-busy={busy || signingIn}>
              {busy || signingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={SECONDARY}
              aria-disabled={wait > 0}
              onClick={() => {
                if (wait === 0) sendLink(sentTo);
              }}
            >
              {wait > 0 ? `Send another in ${wait} s` : 'Send another'}
            </button>
            <button type="button" className={QUIET} onClick={otherEmail}>
              Use a different email
            </button>
          </div>
        </>
      )}

      <p id={noticeId} role="status" className="min-h-5 text-sm text-ink">
        {notice}
      </p>
    </ModalSheet>
  );
}
