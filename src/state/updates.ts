import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { AppNotice } from '@/core';

import type { AccountSession } from './accountSession';
import type { AccountStore } from './accountStore';
import { wallClockNow } from './clock';

/**
 * The reader's in-app notices (Prompt 4.3): the outcome of each report they
 * made, and any post of theirs that was removed, with its strike. The
 * account button shows a dot while some are unread; the account sheet lists
 * them and marks them read.
 */

export interface UpdatesState {
  readonly unread: number;
  /** Newest first, as they were before this showing marked them read; null until shown. */
  readonly notices: readonly AppNotice[] | null;
  readonly loading: boolean;
  /** The list could not be read. */
  readonly failed: boolean;
}

/** How many the sheet lists: the latest, not an archive. */
export const UPDATES_SHOWN = 20;

const EMPTY: UpdatesState = { unread: 0, notices: null, loading: false, failed: false };

export type UpdatesStore = StoreApi<UpdatesState>;

export function createUpdatesStore(): UpdatesStore {
  return createStore<UpdatesState>()(() => EMPTY);
}

export const updatesStore: UpdatesStore = createUpdatesStore();

export function useUpdatesStore<T>(selector: (state: UpdatesState) => T): T {
  return useStore(updatesStore, selector);
}

export interface UpdatesController {
  /** Reads the unread count. Runs on its own when the reader is signed in. */
  refresh(): Promise<void>;
  /** Reads the list and marks it read: the account sheet is showing it. */
  show(): Promise<void>;
  dispose(): void;
}

export interface UpdatesControllerOptions {
  readonly store: UpdatesStore;
  readonly accounts: AccountStore;
  readonly load: () => Promise<AccountSession>;
  readonly now?: () => number;
}

export function createUpdatesController(options: UpdatesControllerOptions): UpdatesController {
  const { store, accounts, load } = options;
  const now = options.now ?? wallClockNow;
  /** Bumped when the reader signs in or out, so a late reply about the last one is dropped. */
  let generation = 0;

  const signedIn = (): boolean => accounts.getState().status === 'signed-in';

  async function refresh(): Promise<void> {
    if (!signedIn()) return;
    const mine = generation;
    try {
      const unread = await (await load()).moderation.unreadNotices();
      if (mine === generation) store.setState({ unread });
    } catch {
      // The dot waits for the next look; nothing else depends on it.
    }
  }

  async function show(): Promise<void> {
    if (!signedIn()) return;
    const mine = generation;
    store.setState({ loading: true, failed: false });
    try {
      const { moderation } = await load();
      const notices = await moderation.notices(UPDATES_SHOWN);
      if (mine !== generation) return;
      store.setState({ notices, loading: false });
      if (notices.some((notice) => notice.readAtMs === null)) {
        await moderation.markNoticesRead(now());
        if (mine === generation) store.setState({ unread: 0 });
      }
    } catch {
      if (mine === generation) store.setState({ loading: false, failed: true });
    }
  }

  const stop = accounts.subscribe((state, previous) => {
    if (state.status === previous.status) return;
    if (state.status === 'signed-in') {
      generation += 1;
      void refresh();
    } else if (state.status === 'signed-out') {
      generation += 1;
      store.setState(EMPTY);
    }
  });
  if (signedIn()) void refresh();

  return {
    refresh,
    show,
    dispose: stop,
  };
}
