import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { followKey, isFollow, type Follow, type FollowKind, type LibraryRemote } from '@/core';

import { wallClockNow } from './clock';
import { createLibraryList } from './libraryList';
import { browserStorage, type KeyValueStorage } from './persist';

/**
 * What the reader follows: places, categories and single stories (Prompt
 * 3.4). Signed out it lives in localStorage; signed in, in the account
 * (library.ts moves it up). The Following feed is built from it.
 */

export type FollowInput = Omit<Follow, 'createdAtMs'>;
export type FollowResult = 'followed' | 'unfollowed';

export interface FollowsState {
  /** Newest first. */
  readonly follows: readonly Follow[];
  /** Account writes that failed and were read back: the UI says so. */
  readonly failures: number;
  toggle(input: FollowInput): FollowResult;
  /** Follows each one not already followed; returns how many were new. */
  addAll(inputs: readonly FollowInput[]): number;
  remove(kind: FollowKind, target: string): void;
  attach(remote: LibraryRemote | null, follows?: readonly Follow[]): void;
  deviceItems(): Follow[];
  forgetOnDevice(keys: ReadonlySet<string>): void;
}

export type FollowsStore = StoreApi<FollowsState>;

export const FOLLOWS_STORAGE_KEY = 'agora.follows.v1';

export function createFollowsStore(
  storage: KeyValueStorage | null = browserStorage(),
  now: () => number = wallClockNow,
): FollowsStore {
  return createStore<FollowsState>()((set, get) => {
    const list = createLibraryList<Follow>({
      storage,
      storageKey: FOLLOWS_STORAGE_KEY,
      isItem: isFollow,
      keyOf: followKey,
      backend: {
        list: (remote) => remote.listFollows(),
        add: (remote, follows) => remote.addFollows(follows),
        remove: (remote, follow) => remote.removeFollow(follow.kind, follow.target),
      },
      onChange: (follows) => set({ follows }),
      onFailure: () => set({ failures: get().failures + 1 }),
    });

    return {
      follows: list.items(),
      failures: 0,

      toggle(input) {
        const current = list.items();
        const key = followKey(input);
        const existing = current.find((follow) => followKey(follow) === key);
        if (existing) {
          list.apply(
            current.filter((follow) => follow !== existing),
            { remove: existing },
          );
          return 'unfollowed';
        }
        const follow: Follow = { ...input, createdAtMs: now() };
        list.apply([follow, ...current], { add: [follow] });
        return 'followed';
      },

      addAll(inputs) {
        const current = list.items();
        const have = new Set(current.map(followKey));
        const added: Follow[] = [];
        const at = now();
        for (const input of inputs) {
          const key = followKey(input);
          if (have.has(key)) continue;
          have.add(key);
          added.push({ ...input, createdAtMs: at });
        }
        if (added.length > 0) list.apply([...added, ...current], { add: added });
        return added.length;
      },

      remove(kind, target) {
        const current = list.items();
        const existing = current.find((follow) => follow.kind === kind && follow.target === target);
        if (!existing) return;
        list.apply(
          current.filter((follow) => follow !== existing),
          { remove: existing },
        );
      },

      attach: (remote, follows) => list.attach(remote, follows),
      deviceItems: () => list.deviceItems(),
      forgetOnDevice: (keys) => list.forgetOnDevice(keys),
    };
  });
}

/** The app's single follows store. */
export const followsStore: FollowsStore = createFollowsStore();

export function useFollowsStore<T>(selector: (state: FollowsState) => T): T {
  return useStore(followsStore, selector);
}

export function isFollowing(state: FollowsState, kind: FollowKind, target: string): boolean {
  return state.follows.some((follow) => follow.kind === kind && follow.target === target);
}
