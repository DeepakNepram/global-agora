import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import type { Follow, FollowKind, LibraryRemote, SavedStory } from '@/core';

import { hasStoredSession } from './accountSession';
import { createFollowsStore, FOLLOWS_STORAGE_KEY } from './followsStore';
import { enterAccount, leaveAccount, MOVE_UP_FAILED, type LibraryStatus } from './library';
import type { KeyValueStorage } from './persist';
import { createSavedStore, SAVED_STORAGE_KEY } from './savedStore';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

/** An account in memory, with switches to make it fail. */
function fakeAccount(start: { follows?: Follow[]; saved?: SavedStory[] } = {}) {
  const account = { follows: [...(start.follows ?? [])], saved: [...(start.saved ?? [])] };
  const failing = { writes: false, reads: false };
  const calls: string[] = [];
  const remote: LibraryRemote = {
    async listFollows() {
      calls.push('listFollows');
      if (failing.reads) throw new Error('offline');
      return [...account.follows];
    },
    async addFollows(follows) {
      calls.push(`addFollows:${follows.length}`);
      if (failing.writes) throw new Error('offline');
      for (const follow of follows) {
        const dup = account.follows.some(
          (f) => f.kind === follow.kind && f.target === follow.target,
        );
        if (!dup) account.follows.unshift(follow);
      }
    },
    async removeFollow(kind: FollowKind, target: string) {
      calls.push(`removeFollow:${target}`);
      if (failing.writes) throw new Error('offline');
      account.follows = account.follows.filter((f) => !(f.kind === kind && f.target === target));
    },
    async listSaved() {
      calls.push('listSaved');
      if (failing.reads) throw new Error('offline');
      return [...account.saved];
    },
    async addSaved(stories) {
      calls.push(`addSaved:${stories.length}`);
      if (failing.writes) throw new Error('offline');
      for (const story of stories) {
        if (!account.saved.some((s) => s.id === story.id)) account.saved.unshift(story);
      }
    },
    async removeSaved(id) {
      calls.push(`removeSaved:${id}`);
      if (failing.writes) throw new Error('offline');
      account.saved = account.saved.filter((s) => s.id !== id);
    },
  };
  return { remote, account, failing, calls };
}

function stores(storage = memoryStorage()) {
  return {
    storage,
    follows: createFollowsStore(storage, () => 1_000),
    saved: createSavedStore(storage, () => 2_000),
    status: createStore<LibraryStatus>()(() => ({ mode: 'device' as const, problem: null })),
  };
}

const TECH = { kind: 'category', target: 'tech', label: 'Tech', baseline: null } as const;
const JAPAN = { kind: 'place', target: 'country:JP', label: 'Japan', baseline: null } as const;
const STORY = { id: 7, headline: 'Vote nears', place: 'London', publishedAtMs: 5 };

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('follows on the device', () => {
  it('toggles, adds many once each, and keeps them in localStorage', () => {
    const { follows, storage } = stores();
    expect(follows.getState().toggle(TECH)).toBe('followed');
    expect(follows.getState().addAll([TECH, JAPAN])).toBe(1);
    expect(follows.getState().follows.map((f) => f.target)).toEqual(['country:JP', 'tech']);
    expect(JSON.parse(storage.data[FOLLOWS_STORAGE_KEY] ?? '[]')).toHaveLength(2);
    expect(follows.getState().toggle(TECH)).toBe('unfollowed');
    follows.getState().remove('place', 'country:JP');
    expect(follows.getState().follows).toEqual([]);
  });

  it('reads back only well-formed follows', () => {
    const storage = memoryStorage({
      [FOLLOWS_STORAGE_KEY]: JSON.stringify([
        { ...TECH, createdAtMs: 1 },
        { ...TECH, createdAtMs: 2 },
        { kind: 'place', target: '51.5,-0.1', label: 'London', baseline: null, createdAtMs: 3 },
      ]),
    });
    expect(createFollowsStore(storage).getState().follows).toHaveLength(1);
  });
});

describe('enterAccount', () => {
  it("moves the device's follows and saves up, merges with the account, then forgets them on the device", async () => {
    const s = stores();
    s.follows.getState().addAll([TECH, JAPAN]);
    s.saved.getState().toggle(STORY, 50);
    const { remote, account } = fakeAccount({ follows: [{ ...TECH, createdAtMs: 0 }] });

    expect(await enterAccount(remote, s)).toBe(true);
    expect(s.status.getState()).toEqual({ mode: 'account', problem: null });
    expect(account.follows.map((f) => f.target).sort()).toEqual(['country:JP', 'tech']);
    expect(account.saved.map((story) => story.id)).toEqual([7]);
    expect(s.follows.getState().follows).toHaveLength(2);
    expect(JSON.parse(s.storage.data[FOLLOWS_STORAGE_KEY] ?? 'null')).toEqual([]);
    expect(JSON.parse(s.storage.data[SAVED_STORAGE_KEY] ?? 'null')).toEqual([]);
  });

  it('drops nothing past the saved limit', async () => {
    const s = stores();
    s.saved.getState().toggle(STORY, 50);
    s.saved.getState().toggle({ ...STORY, id: 8 }, 50);
    const accountSaves = Array.from({ length: 50 }, (_, i) => ({
      ...STORY,
      id: 100 + i,
      savedAtMs: 0,
    }));
    const { remote, account } = fakeAccount({ saved: accountSaves });
    await enterAccount(remote, s);
    expect(account.saved).toHaveLength(52);
    // The limit still blocks a new save.
    expect(s.saved.getState().toggle({ ...STORY, id: 9 }, 50)).toBe('full');
  });

  it('keeps everything on the device when the account cannot be reached', async () => {
    const s = stores();
    s.follows.getState().toggle(TECH);
    const { remote, failing } = fakeAccount();
    failing.writes = true;
    expect(await enterAccount(remote, s)).toBe(false);
    expect(s.status.getState()).toEqual({ mode: 'device', problem: MOVE_UP_FAILED });
    expect(s.follows.getState().follows).toHaveLength(1);
    expect(JSON.parse(s.storage.data[FOLLOWS_STORAGE_KEY] ?? '[]')).toHaveLength(1);
  });

  it('writes to the account once signed in, and reads it back when a write fails', async () => {
    const s = stores();
    const { remote, account, failing, calls } = fakeAccount();
    await enterAccount(remote, s);
    s.follows.getState().toggle(TECH);
    await settle();
    expect(account.follows.map((f) => f.target)).toEqual(['tech']);
    expect(s.storage.data[FOLLOWS_STORAGE_KEY]).toBeUndefined();

    failing.writes = true;
    s.follows.getState().toggle(JAPAN);
    expect(s.follows.getState().follows).toHaveLength(2);
    await settle();
    await settle();
    expect(s.follows.getState().failures).toBe(1);
    expect(s.follows.getState().follows.map((f) => f.target)).toEqual(['tech']);
    expect(calls).toContain('listFollows');
  });

  it("goes back to the device's (now empty) lists on sign-out", async () => {
    const s = stores();
    s.follows.getState().toggle(TECH);
    await enterAccount(fakeAccount().remote, s);
    leaveAccount(s);
    expect(s.follows.getState().follows).toEqual([]);
    expect(s.status.getState().mode).toBe('device');
  });

  it('moves up what is added while it runs', async () => {
    const s = stores();
    s.follows.getState().toggle(TECH);
    const fake = fakeAccount();
    const add = fake.remote.addFollows.bind(fake.remote);
    let first = true;
    fake.remote.addFollows = vi.fn(async (follows: readonly Follow[]) => {
      await add(follows);
      if (first) {
        first = false;
        s.follows.getState().toggle(JAPAN);
      }
    });
    await enterAccount(fake.remote, s);
    expect(fake.account.follows.map((f) => f.target).sort()).toEqual(['country:JP', 'tech']);
  });
});

describe('hasStoredSession', () => {
  it("looks for the SDK's session without loading it", () => {
    expect(hasStoredSession(memoryStorage())).toBe(false);
    expect(hasStoredSession(memoryStorage({ 'agora.auth.v1': '{}' }))).toBe(true);
    expect(hasStoredSession(null)).toBe(false);
  });
});
