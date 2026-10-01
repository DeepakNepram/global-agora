/**
 * A reader's library: their follows (follows.ts) and saved stories. Signed
 * out, it lives on the device; signed in, in the database (`follows`,
 * `saved_stories`). LibraryRemote is the account side, implemented over
 * Supabase in db/library.ts, so the stores in src/state never see the SDK.
 */

import type { Follow, FollowKind } from './follows';

/**
 * A saved story is a snapshot, not just an id: stories leave the API after
 * 48 h, and a saved one must still say what it was.
 */
export interface SavedStory {
  /** The payload id. */
  readonly id: number;
  readonly headline: string;
  readonly place: string;
  readonly publishedAtMs: number;
  readonly savedAtMs: number;
}

export function isSavedStory(value: unknown): value is SavedStory {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'number' &&
    Number.isSafeInteger(v['id']) &&
    v['id'] > 0 &&
    typeof v['headline'] === 'string' &&
    typeof v['place'] === 'string' &&
    typeof v['publishedAtMs'] === 'number' &&
    typeof v['savedAtMs'] === 'number'
  );
}

/** The account's copy of the library. Every call is one round trip. */
export interface LibraryRemote {
  /** Newest first. */
  listFollows(): Promise<Follow[]>;
  /** Adds them, ignoring any the account already has. */
  addFollows(follows: readonly Follow[]): Promise<void>;
  removeFollow(kind: FollowKind, target: string): Promise<void>;
  /** Newest save first. */
  listSaved(): Promise<SavedStory[]>;
  /** Adds them, ignoring any the account already has. */
  addSaved(stories: readonly SavedStory[]): Promise<void>;
  removeSaved(id: number): Promise<void>;
}
