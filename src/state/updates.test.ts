import { describe, expect, it, vi } from 'vitest';

import type { AppNotice, ModerationRemote } from '@/core';

import type { AccountSession } from './accountSession';
import { createAccountStore } from './accountStore';
import { createUpdatesController, createUpdatesStore, UPDATES_SHOWN } from './updates';

function notice(id: string, readAtMs: number | null): AppNotice {
  return {
    id,
    kind: 'report_outcome',
    outcome: 'kept',
    createdAtMs: 0,
    readAtMs,
    postId: null,
    storyId: null,
    prompt: null,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(start: { notices?: AppNotice[]; signedIn?: boolean } = {}) {
  let notices = start.notices ?? [notice('a', null), notice('b', 5)];
  const failing = { list: false };
  const moderation = {
    unreadNotices: vi.fn(async () => notices.filter((n) => n.readAtMs === null).length),
    notices: vi.fn(async (limit: number) => {
      if (failing.list) throw new Error('offline');
      return notices.slice(0, limit);
    }),
    markNoticesRead: vi.fn(async (nowMs: number) => {
      notices = notices.map((n) => (n.readAtMs === null ? { ...n, readAtMs: nowMs } : n));
    }),
  } as unknown as ModerationRemote;
  const session = { moderation } as AccountSession;
  const accounts = createAccountStore();
  if (start.signedIn) accounts.setState({ status: 'signed-in' });
  const store = createUpdatesStore();
  const controller = createUpdatesController({
    store,
    accounts,
    load: async () => session,
    now: () => 1000,
  });
  return { accounts, store, controller, moderation, failing };
}

describe('createUpdatesController', () => {
  it('counts unread notices when the reader is signed in, not before', async () => {
    const { accounts, store, moderation } = setup();
    await settle();
    expect(moderation.unreadNotices).not.toHaveBeenCalled();
    accounts.setState({ status: 'signed-in' });
    await settle();
    expect(store.getState().unread).toBe(1);
  });

  it('counts at once when made for a reader already signed in', async () => {
    const { store } = setup({ signedIn: true });
    await settle();
    expect(store.getState().unread).toBe(1);
  });

  it('lists the latest notices as they were, then marks them read', async () => {
    const { store, controller, moderation } = setup({ signedIn: true });
    await settle();
    await controller.show();
    expect(moderation.notices).toHaveBeenCalledWith(UPDATES_SHOWN);
    expect(store.getState().notices?.map((n) => [n.id, n.readAtMs])).toEqual([
      ['a', null],
      ['b', 5],
    ]);
    expect(moderation.markNoticesRead).toHaveBeenCalledWith(1000);
    expect(store.getState().unread).toBe(0);
  });

  it('does not mark anything when all are read', async () => {
    const { controller, moderation } = setup({ signedIn: true, notices: [notice('b', 5)] });
    await controller.show();
    expect(moderation.markNoticesRead).not.toHaveBeenCalled();
  });

  it('says when the list could not be read', async () => {
    const { store, controller, failing } = setup({ signedIn: true });
    failing.list = true;
    await controller.show();
    expect(store.getState()).toMatchObject({ failed: true, loading: false, notices: null });
  });

  it('forgets everything on signing out, and drops a reply that comes after', async () => {
    const { accounts, store, controller } = setup({ signedIn: true });
    await settle();
    const showing = controller.show();
    accounts.setState({ status: 'signed-out' });
    await showing;
    expect(store.getState()).toEqual({ unread: 0, notices: null, loading: false, failed: false });
  });

  it('does nothing for a guest', async () => {
    const { controller, moderation } = setup();
    await controller.show();
    await controller.refresh();
    expect(moderation.notices).not.toHaveBeenCalled();
    expect(moderation.unreadNotices).not.toHaveBeenCalled();
  });
});
