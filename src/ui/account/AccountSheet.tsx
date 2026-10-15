import { useLayoutEffect, useRef, useState, type JSX } from 'react';

import {
  accountStore,
  getAccountController,
  useAccountStore,
  useLibraryStatus,
  DELETED_NOTICE,
} from '@/state';

import { ModalSheet } from '../sheets/ModalSheet';
import { accountButtonElement } from './accountFocus';
import { BODY, DANGER, HEADING, PRIMARY, QUIET, SECONDARY } from './accountStyles';

export interface AccountSheetProps {
  readonly reducedMotion: boolean;
}

type View = 'account' | 'confirm' | 'deleted' | 'unreachable';

/**
 * The account's settings (Prompt 4.1): who is signed in, Sign out (this
 * device), and Delete account, which is two taps from the globe (the account
 * button, then Delete account) and confirmed on a third. Deleting takes the
 * profile, follows, saves, posts and votes, for good.
 */
export function AccountSheet({ reducedMotion }: AccountSheetProps): JSX.Element {
  const open = useAccountStore((state) => state.sheet === 'account');
  const status = useAccountStore((state) => state.status);
  const profile = useAccountStore((state) => state.profile);
  const email = useAccountStore((state) => state.email);
  const notice = useAccountStore((state) => state.notice);
  const busy = useAccountStore((state) => state.busy);
  const libraryProblem = useLibraryStatus((state) => state.problem);
  const [confirming, setConfirming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const controller = getAccountController();

  // Every opening starts on the account, not on a confirmation left open.
  useLayoutEffect(() => {
    if (open) setConfirming(false);
  }, [open]);

  const view: View =
    notice === DELETED_NOTICE && status === 'signed-out'
      ? 'deleted'
      : status === 'unreachable'
        ? 'unreachable'
        : confirming
          ? 'confirm'
          : 'account';
  const close = (): void => accountStore.getState().closeSheet();

  const deleteAccount = async (): Promise<void> => {
    if (busy || controller === null) return;
    const deleted = await controller.deleteAccount();
    if (!deleted) setConfirming(false);
  };

  const title =
    view === 'confirm'
      ? 'Delete your account?'
      : view === 'deleted'
        ? 'Account deleted'
        : profile
          ? `@${profile.handle}`
          : 'Your account';

  return (
    <ModalSheet
      open={open}
      titleId="account-title"
      heading={heading}
      focusKey={view}
      focusTarget={view === 'confirm' ? cancel : null}
      reducedMotion={reducedMotion}
      fallbackFocus={accountButtonElement}
      onDismiss={close}
      role={view === 'confirm' ? 'alertdialog' : 'dialog'}
      header={
        <>
          <p className="text-xs text-muted">Account</p>
          <button type="button" className={QUIET} onClick={close}>
            Close
          </button>
        </>
      }
    >
      <h2 id="account-title" ref={heading} tabIndex={-1} className={HEADING}>
        {title}
      </h2>

      {view === 'account' && (
        <>
          {email !== null && (
            <p className={BODY}>
              Signed in as <span className="text-ink">{email}</span>.
            </p>
          )}
          <p className={BODY}>
            {libraryProblem ?? 'Your follows and saves are kept in your account, on every device.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={SECONDARY}
              aria-busy={busy}
              onClick={() => void controller?.signOut()}
            >
              Sign out
            </button>
            <button type="button" className={SECONDARY} onClick={() => setConfirming(true)}>
              Delete account
            </button>
          </div>
        </>
      )}

      {view === 'confirm' && (
        <>
          <p className="text-sm text-ink">
            This deletes your account, your handle, your follows and saves, and any posts and votes,
            for good. It cannot be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              ref={cancel}
              type="button"
              className={SECONDARY}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={DANGER}
              aria-busy={busy}
              onClick={() => void deleteAccount()}
            >
              {busy ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </>
      )}

      {view === 'unreachable' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={PRIMARY} onClick={() => void controller?.retry()}>
            Try again
          </button>
          <button type="button" className={SECONDARY} onClick={() => void controller?.signOut()}>
            Sign out
          </button>
        </div>
      )}

      {view === 'deleted' ? (
        <>
          <p className="text-sm text-ink">{notice}</p>
          <button type="button" className={`${PRIMARY} self-start`} onClick={close}>
            Close
          </button>
        </>
      ) : (
        <p role="status" className="min-h-5 text-sm text-ink">
          {notice}
        </p>
      )}
    </ModalSheet>
  );
}
