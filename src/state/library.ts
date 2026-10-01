import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { followKey, type LibraryRemote } from '@/core';

import { followsStore, type FollowsStore } from './followsStore';
import { savedKey, savedStore, type SavedStore } from './savedStore';

/**
 * Where the library lives, and moving it there on sign-in (Prompt 3.4:
 * "migrate localStorage follows up on sign-in", and the same for saves).
 *
 * Moving up adds the device's follows and saves to the account (anything the
 * account already has is ignored, so a retry is harmless), forgets only what
 * was sent, and repeats if the reader added more meanwhile. Nothing is
 * dropped: not past the saved limit either (Prompt 4.1, "nothing lost"). If
 * the account cannot be reached, the device keeps everything and the next
 * start tries again.
 */

export type LibraryMode = 'device' | 'moving' | 'account';

export interface LibraryStatus {
  readonly mode: LibraryMode;
  /** Said to the reader when moving up failed. */
  readonly problem: string | null;
}

export type LibraryStatusStore = StoreApi<LibraryStatus>;

export const libraryStatus: LibraryStatusStore = createStore<LibraryStatus>()(() => ({
  mode: 'device',
  problem: null,
}));

export function useLibraryStatus<T>(selector: (state: LibraryStatus) => T): T {
  return useStore(libraryStatus, selector);
}

export const MOVE_UP_FAILED =
  'Could not reach your account. Your follows and saves stay on this device for now.';

/** Rounds of moving up, for a reader still adding while the first one runs. */
const MOVE_UP_ROUNDS = 3;

export interface LibraryStores {
  readonly follows: FollowsStore;
  readonly saved: SavedStore;
  readonly status: LibraryStatusStore;
}

const APP_STORES: LibraryStores = {
  follows: followsStore,
  saved: savedStore,
  status: libraryStatus,
};

/** Signed in: moves the device's library up, then shows and writes the account's. */
export async function enterAccount(
  remote: LibraryRemote,
  stores: LibraryStores = APP_STORES,
): Promise<boolean> {
  const { follows, saved, status } = stores;
  status.setState({ mode: 'moving', problem: null });
  try {
    for (let round = 0; round < MOVE_UP_ROUNDS; round++) {
      const deviceFollows = follows.getState().deviceItems();
      const deviceSaved = saved.getState().deviceItems();
      if (deviceFollows.length === 0 && deviceSaved.length === 0) break;
      await remote.addFollows(deviceFollows);
      await remote.addSaved(deviceSaved);
      follows.getState().forgetOnDevice(new Set(deviceFollows.map(followKey)));
      saved.getState().forgetOnDevice(new Set(deviceSaved.map(savedKey)));
    }
    const [accountFollows, accountSaved] = await Promise.all([
      remote.listFollows(),
      remote.listSaved(),
    ]);
    follows.getState().attach(remote, accountFollows);
    saved.getState().attach(remote, accountSaved);
    status.setState({ mode: 'account', problem: null });
    return true;
  } catch {
    status.setState({ mode: 'device', problem: MOVE_UP_FAILED });
    return false;
  }
}

/** Signed out: back to what the device holds (empty, once it was moved up). */
export function leaveAccount(stores: LibraryStores = APP_STORES): void {
  stores.follows.getState().attach(null);
  stores.saved.getState().attach(null);
  stores.status.setState({ mode: 'device', problem: null });
}
