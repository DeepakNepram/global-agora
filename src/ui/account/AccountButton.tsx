import type { JSX } from 'react';

import { accountStore, useAccountStore, type AccountState } from '@/state';

const BUTTON =
  'flex h-10 max-w-44 shrink-0 items-center justify-center gap-2 rounded-full border border-ink/20 bg-panel/90 px-4 text-sm font-medium text-ink hover:bg-white/10 max-sm:size-11 max-sm:px-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-expanded:border-accent aria-expanded:text-accent';

function PersonIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0 fill-none stroke-current"
    >
      <circle cx="8" cy="5.5" r="2.75" strokeWidth="1.4" />
      <path
        d="M2.75 13.75c.6-2.6 2.75-4 5.25-4s4.65 1.4 5.25 4"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function label(state: Pick<AccountState, 'status' | 'profile'>): string {
  switch (state.status) {
    case 'signed-out':
      return 'Sign in';
    case 'setup':
      return 'Finish signing up';
    case 'signed-in':
    case 'loading':
      return state.profile ? `@${state.profile.handle}` : 'Account';
    case 'unreachable':
      return 'Account';
  }
}

/**
 * Sign in, or the signed-in handle, at the end of the search row. It opens
 * the sign-in sheet for a guest, the setup still to finish, or the account
 * sheet (sign out, delete). On a phone it is a 44 px icon with its name in
 * the accessible name, like Following and Saved.
 */
export function AccountButton(): JSX.Element {
  const status = useAccountStore((state) => state.status);
  const profile = useAccountStore((state) => state.profile);
  const open = useAccountStore((state) => state.sheet !== null);
  const text = label({ status, profile });

  const onClick = (): void => {
    const store = accountStore.getState();
    if (store.sheet !== null) store.closeSheet();
    else if (status === 'signed-out') store.openSignIn();
    else store.openAccount();
  };

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onClick}
      className={BUTTON}
    >
      <PersonIcon />
      <span className="truncate max-sm:sr-only">{text}</span>
    </button>
  );
}
