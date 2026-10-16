import { describe, expect, it, vi } from 'vitest';

import { ModerationError, type AccountRemote, type Profile } from '@/core';
import type { AdminRemote, QueueItem } from '@/core/moderationQueue';

import { createQueueController, createQueueStore, type AdminSession } from './moderationQueue';

function item(postId: string): QueueItem {
  return {
    postId,
    storyId: 's1',
    prompt: 'Should the port reopen?',
    sideLabel: 'Reopen',
    body: 'A post',
    kind: 'argument',
    evidenceUrl: null,
    createdAtMs: 0,
    authorId: 'u1',
    authorHandle: 'heron',
    authorStrikes: 0,
    authorSuspended: false,
    strikesToSuspend: 3,
    queuedFor: 'hidden',
    waitingSinceMs: 0,
    reportCount: 0,
    reportReasons: {},
    toxicity: 0.7,
    flagged: [],
  };
}

function setup(start: { signedIn?: boolean; admin?: boolean; queue?: QueueItem[] } = {}) {
  const profile: Profile = {
    handle: 'mod_one',
    isAdult: true,
    rulesAcceptedAtMs: 0,
    tier: 'free',
    createdAtMs: 0,
    strikes: 0,
    suspendedAtMs: null,
    isAdmin: start.admin ?? true,
  };
  const failing: { act: ModerationError | null } = { act: null };
  const admin: AdminRemote = {
    queue: vi.fn(async () => {
      if (start.admin === false) throw new ModerationError('not-allowed', 'moderators only');
      return start.queue ?? [item('p1'), item('p2'), item('p3')];
    }),
    act: vi.fn(async (_postId: string, action: string) => {
      if (failing.act) throw failing.act;
      return action === 'approve' ? ('ok' as const) : ('removed' as const);
    }),
  };
  const session: AdminSession = {
    account: { myProfile: async () => profile } as unknown as AccountRemote,
    admin,
    signedIn: async () => start.signedIn ?? true,
  };
  const store = createQueueStore();
  const controller = createQueueController({ store, load: async () => session });
  return { store, controller, admin, failing };
}

describe('createQueueController', () => {
  it('asks a signed-out visitor to sign in on the globe first', async () => {
    const { store, controller, admin } = setup({ signedIn: false });
    await controller.start();
    expect(store.getState().status).toBe('signed-out');
    expect(admin.queue).not.toHaveBeenCalled();
  });

  it('turns away a reader who does not moderate', async () => {
    const { store, controller, admin } = setup({ admin: false });
    await controller.start();
    expect(store.getState()).toMatchObject({ status: 'not-admin', handle: 'mod_one' });
    expect(admin.queue).not.toHaveBeenCalled();
  });

  it('loads the queue for an admin', async () => {
    const { store, controller } = setup();
    await controller.start();
    expect(store.getState().status).toBe('ready');
    expect(store.getState().items.map((i) => i.postId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('takes a decided post off the list and says what happened', async () => {
    const { store, controller, admin } = setup();
    await controller.start();
    expect(await controller.act('p2', 'strike')).toBe(true);
    expect(admin.act).toHaveBeenCalledWith('p2', 'strike');
    expect(store.getState()).toMatchObject({
      acting: null,
      message: 'Removed, and the author has a strike. 2 waiting.',
    });
    expect(store.getState().items.map((i) => i.postId)).toEqual(['p1', 'p3']);
  });

  it('drops a post someone else decided, and keeps one whose action failed', async () => {
    const { store, controller, failing } = setup();
    await controller.start();
    failing.act = new ModerationError('out-of-order', 'already removed');
    await controller.act('p1', 'remove');
    expect(store.getState().message).toBe('Already dealt with by someone else. 2 waiting.');
    failing.act = new ModerationError('network', 'offline');
    expect(await controller.act('p2', 'approve')).toBe(false);
    expect(store.getState().items.map((i) => i.postId)).toEqual(['p2', 'p3']);
    expect(store.getState().message).toMatch(/did not go through/);
  });

  it('says when the last one is done', async () => {
    const { store, controller } = setup({ queue: [item('p1')] });
    await controller.start();
    await controller.act('p1', 'approve');
    expect(store.getState().message).toBe('Approved: it is public. Nothing else waiting.');
  });
});
