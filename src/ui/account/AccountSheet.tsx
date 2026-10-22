import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';

import type { Profile } from '@/core';
import {
  accountStore,
  getAccountController,
  getUpdatesController,
  useAccountStore,
  useLibraryStatus,
  DELETED_NOTICE,
} from '@/state';

import { ModalSheet } from '../sheets/ModalSheet';
import { accountButtonElement } from './accountFocus';
import { BODY, DANGER, HEADING, PRIMARY, QUIET, SECONDARY } from './accountStyles';
import { BlockedList } from './BlockedList';
import { UpdatesList } from './UpdatesList';

export interface AccountSheetProps {
  readonly reducedMotion: boolean;
}

type View = 'account' | 'confirm' | 'deleted' | 'unreachable';

/** Where the account stands after strikes (Prompt 4.3); nothing for a clean record. */
function Standing({ profile }: { profile: Profile }): JSX.Element | null {
  if (profile.suspendedAtMs !== null) {
    return (
      <p className="rounded-xl border border-red-400/50 px-3 py-2 text-sm text-ink">
        Posting, voting and taking sides are suspended on this account after {profile.strikes}{' '}
        strikes for removed posts. You can still read, report, block and delete your account.
      </p>
    );
  }
  if (profile.strikes === 0) return null;
  return (
    <p className={BODY}>
      This account has {profile.strikes} {profile.strikes === 1 ? 'strike' : 'strikes'} for removed
      posts.
    </p>
  );
}

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

  // Opening the sheet shows the reader's updates, which marks them read.
  useEffect(() => {
    if (open && status === 'signed-in') void getUpdatesController()?.show();
  }, [open, status]);

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
          {profile !== null && <Standing profile={profile} />}
          {status === 'signed-in' && <UpdatesList />}
          {status === 'signed-in' && <BlockedList />}
          <div className="flex flex-wrap gap-2">
            {profile?.isAdmin === true && (
              <a href="/admin" className={`${SECONDARY} inline-flex items-center`}>
                Admin console
              </a>
            )}
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
