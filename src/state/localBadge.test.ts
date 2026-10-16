import { describe, expect, it } from 'vitest';

import type { LocalBadgeReply } from '@/core/localBadge';

import { createLocalBadgeController, createLocalBadgeStore } from './localBadge';

describe('createLocalBadgeController', () => {
  it('shows checking, then what the Worker said', async () => {
    const store = createLocalBadgeStore();
    let answer: (reply: LocalBadgeReply) => void = () => undefined;
    const controller = createLocalBadgeController({
      store,
      fetchBadge: () => new Promise((resolve) => (answer = resolve)),
    });
    const done = controller.check();
    expect(store.getState()).toEqual({ kind: 'checking' });
    answer({ label: 'Bengaluru area, India' });
    await done;
    expect(store.getState()).toEqual({ kind: 'available', label: 'Bengaluru area, India' });
  });

  it('passes on why there is no badge', async () => {
    for (const reason of ['no-city', 'unavailable'] as const) {
      const store = createLocalBadgeStore();
      await createLocalBadgeController({
        store,
        fetchBadge: async () => ({ label: null, reason }),
      }).check();
      expect(store.getState()).toEqual({ kind: reason });
    }
  });

  it('says it failed when the Worker cannot be asked', async () => {
    const store = createLocalBadgeStore();
    await createLocalBadgeController({
      store,
      fetchBadge: () => Promise.reject(new Error('offline')),
    }).check();
    expect(store.getState()).toEqual({ kind: 'failed' });
  });

  it('keeps the newest answer when an older one arrives late', async () => {
    const store = createLocalBadgeStore();
    const answers: ((reply: LocalBadgeReply) => void)[] = [];
    const controller = createLocalBadgeController({
      store,
      fetchBadge: () => new Promise((resolve) => answers.push(resolve)),
    });
    const first = controller.check();
    const second = controller.check();
    answers[1]?.({ label: null, reason: 'no-city' });
    await second;
    answers[0]?.({ label: 'Bengaluru area, India' });
    await first;
    expect(store.getState()).toEqual({ kind: 'no-city' });
  });
});
