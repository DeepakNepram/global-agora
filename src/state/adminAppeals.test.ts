import { describe, expect, it, vi } from 'vitest';

import { AdminError } from '@/core/admin';
import type { AdminAppeal } from '@/core/appeal';

import { createAppealsController, createAppealsStore, pendingCount } from './adminAppeals';
import type { AdminSession } from './adminSession';

function appeal(id: string, status: AdminAppeal['status'] = 'pending'): AdminAppeal {
  return {
    id,
    handle: `reader_${id}`,
    body: 'Please look again.',
    status,
    createdAtMs: 0,
    decidedAtMs: status === 'pending' ? null : 1,
    reply: status === 'pending' ? null : 'Decided.',
    strikes: 3,
    suspended: status !== 'granted',
    removedPosts: [],
  };
}

function setup(items: AdminAppeal[]) {
  let list = items;
  const appeals = {
    list: vi.fn(async () => list),
    decide: vi.fn(async (id: string, grant: boolean) => {
      list = list.map((item) =>
        item.id === id ? appeal(id, grant ? 'granted' : 'refused') : item,
      );
      return grant ? ('granted' as const) : ('refused' as const);
    }),
  };
  const session = { appeals } as unknown as AdminSession;
  const store = createAppealsStore();
  const controller = createAppealsController({ store, connect: async () => session });
  return { store, controller, appeals };
}

describe('the appeals tab', () => {
  it('loads the appeals and counts the waiting ones', async () => {
    const { store, controller } = setup([appeal('a'), appeal('b'), appeal('c', 'refused')]);
    await controller.load();
    expect(store.getState().status).toBe('ready');
    expect(pendingCount(store.getState().items)).toBe(2);
  });

  it('grants one, reloads, and says what it did', async () => {
    const { store, controller, appeals } = setup([appeal('a'), appeal('b')]);
    await controller.load();
    expect(await controller.decide('a', true, '  Fair point.  ')).toBe(true);
    expect(appeals.decide).toHaveBeenCalledWith('a', true, 'Fair point.');
    expect(store.getState().message).toBe('Granted: the suspension has ended. 1 waiting.');
    expect(store.getState().deciding).toBeNull();
  });

  it('says when someone else decided first, and reloads', async () => {
    const { store, controller, appeals } = setup([appeal('a')]);
    await controller.load();
    appeals.decide.mockRejectedValueOnce(new AdminError('decided', 'already decided'));
    expect(await controller.decide('a', false, 'No.')).toBe(false);
    expect(store.getState().message).toBe('Someone else decided this appeal first.');
    expect(appeals.list).toHaveBeenCalledTimes(2);
  });
});
