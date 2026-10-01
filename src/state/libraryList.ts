import type { LibraryRemote } from '@/core';

import { readJson, writeJson, type KeyValueStorage } from './persist';

/**
 * One list of the library (follows or saved stories) and where it lives: in
 * localStorage while signed out, in the account while signed in.
 *
 * A change shows at once. On the device it is written straight away; to the
 * account it is sent, and if that fails the list is read back from the
 * account, so the screen never claims what the account does not hold.
 */

/** How a list reads and writes its account copy. */
export interface ListBackend<T> {
  list(remote: LibraryRemote): Promise<T[]>;
  add(remote: LibraryRemote, items: readonly T[]): Promise<void>;
  remove(remote: LibraryRemote, item: T): Promise<void>;
}

export interface ListChange<T> {
  readonly add?: readonly T[];
  readonly remove?: T;
}

export interface LibraryList<T> {
  /** Newest first. */
  items(): readonly T[];
  apply(next: readonly T[], change: ListChange<T>): void;
  /** Signed in: the account's items, written there from now on. Null: back to the device. */
  attach(remote: LibraryRemote | null, items?: readonly T[]): void;
  /** What the device holds, to move up on sign-in. */
  deviceItems(): T[];
  /** Drops these keys from the device once the account has them. */
  forgetOnDevice(keys: ReadonlySet<string>): void;
}

export interface LibraryListOptions<T> {
  readonly storage: KeyValueStorage | null;
  readonly storageKey: string;
  readonly isItem: (value: unknown) => value is T;
  readonly keyOf: (item: T) => string;
  readonly backend: ListBackend<T>;
  /** The store's setter: every change of items comes through here. */
  readonly onChange: (items: readonly T[]) => void;
  /** An account write failed; the list is being read back. */
  readonly onFailure: () => void;
}

export function createLibraryList<T>(options: LibraryListOptions<T>): LibraryList<T> {
  const { storage, storageKey, isItem, keyOf, backend, onChange, onFailure } = options;

  /** What storage holds, well-formed and one per key. */
  const loadDevice = (): T[] => {
    const raw = readJson(storage, storageKey);
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.filter((item): item is T => {
      if (!isItem(item) || seen.has(keyOf(item))) return false;
      seen.add(keyOf(item));
      return true;
    });
  };

  let remote: LibraryRemote | null = null;
  let items: readonly T[] = loadDevice();

  const show = (next: readonly T[]): void => {
    items = next;
    onChange(next);
  };

  return {
    items: () => items,

    apply(next, change) {
      show(next);
      if (remote === null) {
        // Kept in memory even if storage refuses, so the screen tells the truth for this visit.
        writeJson(storage, storageKey, next);
        return;
      }
      const target = remote;
      const writes: Promise<void>[] = [];
      if (change.add && change.add.length > 0) writes.push(backend.add(target, change.add));
      if (change.remove !== undefined) writes.push(backend.remove(target, change.remove));
      Promise.all(writes).catch(async () => {
        onFailure();
        try {
          const truth = await backend.list(target);
          if (remote === target) show(truth);
        } catch {
          // Unreachable: keep what is shown; the next change or start reads it again.
        }
      });
    },

    attach(next, list) {
      remote = next;
      show(next === null ? loadDevice() : (list ?? []));
    },

    // Signed out, memory is the truth: storage may be blocked or full.
    deviceItems: () => (remote === null ? [...items] : loadDevice()),

    forgetOnDevice(keys) {
      const left = (remote === null ? [...items] : loadDevice()).filter(
        (item) => !keys.has(keyOf(item)),
      );
      writeJson(storage, storageKey, left);
      if (remote === null) show(left);
    },
  };
}
