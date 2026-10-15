import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { Profile } from '@/core';

/**
 * The reader's account as the screen shows it (Prompt 4.1). Plain data and
 * the sheet switches; signing in, setup and deletion run in
 * accountController.ts, which writes here.
 *
 * Signed out is the normal state: reading never needs an account, and a
 * guest's follows and saves live on the device (src/state/library.ts).
 */

export type AccountStatus =
  | 'signed-out'
  /** Signed in; reading the profile and moving the library up. */
  | 'loading'
  /** Signed in, but the first sign-in's setup is not finished. */
  | 'setup'
  | 'signed-in'
  /** Signed in, but the account could not be read; the library stays on the device. */
  | 'unreachable';

export type AccountSheet = 'sign-in' | 'setup' | 'account';

/** The first sign-in's required steps, then the end for an under-17 answer. */
export type SetupStep = 'age' | 'handle' | 'rules' | 'under-age';

export interface AccountState {
  readonly status: AccountStatus;
  readonly sheet: AccountSheet | null;
  readonly email: string | null;
  readonly profile: Profile | null;
  readonly step: SetupStep;
  /** Where the sign-in link went, for the code field and for resending. */
  readonly sentTo: string | null;
  readonly sentAtMs: number | null;
  /** What to tell the reader now: a failure or an outcome. */
  readonly notice: string | null;
  /** A request is in flight: its button says so and the others wait. */
  readonly busy: boolean;
  /** Why sign-in was asked for ("Sign in to post."), or null when the reader chose to. */
  readonly reason: string | null;
  /** Opens the sign-in sheet (signed out) or the account sheet (signed in). */
  openSignIn(reason?: string): void;
  openAccount(): void;
  /** Closes the open sheet. Setup cannot be closed this way: "Not now" signs out. */
  closeSheet(): void;
}

export type AccountStore = StoreApi<AccountState>;

export function createAccountStore(): AccountStore {
  return createStore<AccountState>()((set, get) => ({
    status: 'signed-out',
    sheet: null,
    email: null,
    profile: null,
    step: 'age',
    sentTo: null,
    sentAtMs: null,
    notice: null,
    busy: false,
    reason: null,

    openSignIn(reason) {
      const { status } = get();
      if (status === 'setup') set({ sheet: 'setup' });
      else if (status !== 'signed-out') set({ sheet: 'account', notice: null });
      else set({ sheet: 'sign-in', reason: reason ?? null, notice: null });
    },

    openAccount() {
      if (get().status === 'setup') set({ sheet: 'setup' });
      else set({ sheet: 'account', notice: null });
    },

    closeSheet() {
      const { sheet, step } = get();
      if (sheet === 'setup' && step !== 'under-age') return;
      set({ sheet: null, notice: null, reason: null });
    },
  }));
}

/** The app's single account store. */
export const accountStore: AccountStore = createAccountStore();

export function useAccountStore<T>(selector: (state: AccountState) => T): T {
  return useStore(accountStore, selector);
}
