import { describe, expect, it, vi } from 'vitest';

import type { AccountRemote, Profile } from '@/core';
import {
  AdminError,
  type AdminConsoleRemote,
  type AdminCounters,
  type HotStory,
  type SuggestionResult,
} from '@/core/admin';
import type { AdminRemote } from '@/core/moderationQueue';

import { createConsoleController } from './adminConsole';
import { createConsoleStore } from './adminConsoleStore';
import type { AdminSession } from './adminSession';

const NOW = new Date(2026, 9, 22, 8, 0).getTime();

function story(storyId: string, heat: number): HotStory {
  return {
    storyId,
    seq: heat,
    title: `Story ${storyId}`,
    summary: null,
    placeName: 'Paris',
    countryCode: 'FR',
    heat,
    sourceCount: 4,
    publishedAtMs: NOW - 3_600_000,
    locationReports: 0,
  };
}

const COUNTERS: AdminCounters = {
  openDiscussions: 3,
  maxOpen: 25,
  nextCloseAtMs: NOW + 3_600_000,
  postsToday: 12,
  reportsOpen: 2,
  medianActionSeconds: 120,
  reportsResolved: 3,
  medianWindowDays: 7,
};

/** A console whose remote answers as told; the suggestion waits until released. */
function setup(options: { admin?: boolean; signedIn?: boolean } = {}) {
  /** Suggestions asked for and not yet answered, oldest first. */
  const pending: ((result: SuggestionResult) => void)[] = [];
  const remote = {
    storyQueue: vi.fn(async () => [story('s1', 200), story('s2', 150)]),
    counters: vi.fn(async () => COUNTERS),
    suggest: vi.fn(() => new Promise<SuggestionResult>((resolve) => pending.push(resolve))),
    openDiscussion: vi.fn(async (storyId: string) => ({
      storyId,
      closesAtMs: NOW + 48 * 3_600_000,
      openCount: 4,
      maxOpen: 25,
    })),
    locationQueue: vi.fn(),
    fixLocation: vi.fn(),
  } satisfies AdminConsoleRemote;
  const profile = { handle: 'mod', isAdmin: options.admin ?? true } as Profile;
  const session: AdminSession = {
    account: { myProfile: async () => profile } as unknown as AccountRemote,
    admin: {} as AdminRemote,
    console: remote,
    signedIn: async () => options.signedIn ?? true,
  };
  const store = createConsoleStore();
  const controller = createConsoleController({
    store,
    connect: async () => session,
    now: () => NOW,
  });
  const suggested = async (result: SuggestionResult): Promise<void> => {
    await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
    pending.shift()?.(result);
    await vi.waitFor(() => expect(store.getState().form?.suggesting).toBe(false));
  };
  return { store, controller, remote, suggested };
}

const WORDS: SuggestionResult = {
  kind: 'ok',
  draft: { prompt: 'Should Paris ban cars?', sideA: 'Ban', sideB: 'Keep' },
};

describe('arriving', () => {
  it('lets an admin in and loads the counters from local midnight, and the queue', async () => {
    const { store, controller, remote } = setup();
    await controller.start();
    expect(store.getState()).toMatchObject({ access: 'ready', handle: 'mod', counters: COUNTERS });
    expect(store.getState().stories.map((s) => s.storyId)).toEqual(['s1', 's2']);
    expect(remote.counters).toHaveBeenCalledWith(new Date(2026, 9, 22).getTime());
  });

  it('keeps out the signed-out and readers', async () => {
    const out = setup({ signedIn: false });
    await out.controller.start();
    expect(out.store.getState().access).toBe('signed-out');
    const reader = setup({ admin: false });
    await reader.controller.start();
    expect(reader.store.getState().access).toBe('not-admin');
    expect(reader.remote.storyQueue).not.toHaveBeenCalled();
  });

  it('notices when the account stops being an admin', async () => {
    const { store, controller, remote } = setup();
    await controller.start();
    remote.storyQueue.mockRejectedValueOnce(new AdminError('not-admin', 'moderators only'));
    await controller.refresh();
    expect(store.getState().access).toBe('not-admin');
  });
});

describe('opening a discussion', () => {
  it('shows the form at once and fills it when the suggestion arrives', async () => {
    const { store, controller, suggested } = setup();
    await controller.start();
    controller.beginOpen('s1');
    expect(store.getState().form).toMatchObject({ storyId: 's1', suggesting: true });
    await suggested(WORDS);
    expect(store.getState().form).toMatchObject({ draft: WORDS.draft, note: 'suggested' });
  });

  it('never overwrites what the admin typed while it waited', async () => {
    const { store, controller, suggested } = setup();
    await controller.start();
    controller.beginOpen('s1');
    controller.edit('sideA', 'Pedestrianise');
    await suggested(WORDS);
    expect(store.getState().form?.draft).toEqual({
      prompt: 'Should Paris ban cars?',
      sideA: 'Pedestrianise',
      sideB: 'Keep',
    });
  });

  it('says why there are no words, and ignores a suggestion for a closed form', async () => {
    const { store, controller, suggested } = setup();
    await controller.start();
    controller.beginOpen('s1');
    await suggested({ kind: 'none', reason: 'not-configured' });
    expect(store.getState().form).toMatchObject({ note: 'not-configured', draft: { prompt: '' } });
    controller.suggestAgain();
    controller.cancel();
    await Promise.resolve();
    expect(store.getState().form).toBeNull();
  });

  it('opens a draft that fits, and the story leaves the queue', async () => {
    const { store, controller, remote, suggested } = setup();
    await controller.start();
    controller.beginOpen('s1');
    await suggested(WORDS);
    controller.edit('prompt', '  Should  Paris ban cars? ');
    expect(await controller.confirm()).toBe(true);
    expect(remote.openDiscussion).toHaveBeenCalledWith('s1', WORDS.draft);
    expect(store.getState()).toMatchObject({
      form: null,
      message: { kind: 'opened', title: 'Story s1' },
      counters: { openDiscussions: 4 },
    });
    expect(store.getState().stories.map((s) => s.storyId)).toEqual(['s2']);
  });

  it('holds back a draft that does not fit, without asking the database', async () => {
    const { store, controller, remote, suggested } = setup();
    await controller.start();
    controller.beginOpen('s1');
    await suggested({ kind: 'none', reason: 'declined' });
    expect(await controller.confirm()).toBe(false);
    expect(store.getState().form?.problem).toBe('prompt-empty');
    expect(remote.openDiscussion).not.toHaveBeenCalled();
  });

  it('at the cap, keeps the draft and says when the next one closes', async () => {
    const { store, controller, remote, suggested } = setup();
    await controller.start();
    controller.beginOpen('s1');
    await suggested(WORDS);
    remote.openDiscussion.mockRejectedValueOnce(
      new AdminError('cap', '25 discussions are open', NOW + 600_000),
    );
    expect(await controller.confirm()).toBe(false);
    expect(store.getState().message).toEqual({
      kind: 'cap',
      maxOpen: 25,
      nextCloseAtMs: NOW + 600_000,
    });
    expect(store.getState().form).toMatchObject({ sending: false, draft: WORDS.draft });
  });

  it('drops a story someone else opened first', async () => {
    const { store, controller, remote, suggested } = setup();
    await controller.start();
    controller.beginOpen('s2');
    await suggested(WORDS);
    remote.openDiscussion.mockRejectedValueOnce(new AdminError('not-queued', 'already open'));
    await controller.confirm();
    expect(store.getState()).toMatchObject({
      form: null,
      message: { kind: 'gone', title: 'Story s2' },
    });
    expect(store.getState().stories.map((s) => s.storyId)).toEqual(['s1']);
  });
});
