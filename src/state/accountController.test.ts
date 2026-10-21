import { describe, expect, it, vi } from 'vitest';

import {
  AccountError,
  RULES_UPDATED_AT_MS,
  type AccountRemote,
  type LibraryRemote,
  type ModerationRemote,
  type Profile,
} from '@/core';
import type { DiscussionRemote } from '@/core/discussion';
import type { PostingRemote } from '@/core/posting';

import { createAccountController, type AccountEnvironment } from './accountController';
import { DELETED_NOTICE, UNDER_AGE_NOTICE, UNREACHABLE_NOTICE } from './accountMessages';
import type { AccountSession, SessionUser } from './accountSession';
import { createAccountStore } from './accountStore';

const USER: SessionUser = { id: 'user-1', email: 'reader@test.example' };
const AGREED = RULES_UPDATED_AT_MS + 60_000;

function profileOf(handle: string, rulesAcceptedAtMs: number | null): Profile {
  return {
    handle,
    isAdult: true,
    rulesAcceptedAtMs,
    tier: 'free',
    createdAtMs: 0,
    strikes: 0,
    suspendedAtMs: null,
    isAdmin: false,
  };
}

/** Lets queued callbacks and promise chains run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A server in memory: one user, their profile, switches to fail. */
function fakeServer(start: { user?: SessionUser | null; profile?: Profile | null } = {}) {
  let user = start.user ?? null;
  let profile = start.profile ?? null;
  const listeners = new Set<(user: SessionUser | null) => void>();
  const failing = { profile: false };
  const taken = new Set(['taken_one']);
  const emit = (next: SessionUser | null): void => {
    user = next;
    for (const listener of listeners) setTimeout(() => listener(next), 0);
  };
  const account: AccountRemote = {
    sendEmailLink: vi.fn(async () => {}),
    verifyEmailCode: vi.fn(async (_email: string, code: string) => {
      if (code !== '123456') throw new AccountError('bad-code', 'wrong');
      emit(USER);
    }),
    startOAuth: vi.fn(async () => {}),
    signOut: vi.fn(async () => emit(null)),
    email: async () => user?.email ?? null,
    myProfile: vi.fn(async () => {
      if (failing.profile) throw new AccountError('network', 'offline');
      return profile;
    }),
    handlesAvailable: async (handles) => handles.filter((handle) => !taken.has(handle)),
    claimHandle: vi.fn(async (handle: string) => {
      if (taken.has(handle)) throw new AccountError('handle-taken', 'taken');
      profile = profileOf(handle, null);
    }),
    acceptRules: vi.fn(async () => {
      if (profile === null) throw new AccountError('out-of-order', 'no profile');
      profile = { ...profile, rulesAcceptedAtMs: AGREED };
      return AGREED;
    }),
    deleteAccount: vi.fn(async () => {
      profile = null;
    }),
  };
  const session: AccountSession = {
    account,
    library: {} as LibraryRemote,
    moderation: {} as ModerationRemote,
    discussion: {} as DiscussionRemote,
    posting: () => ({}) as PostingRemote,
    onUser(listener) {
      listeners.add(listener);
      const now = user;
      setTimeout(() => listener(now), 0);
      return () => listeners.delete(listener);
    },
    ready: async () => user,
  };
  return { account, session, emit, failing, profile: () => profile };
}

function fakeEnvironment(start: { search?: string; keys?: string[]; stored?: boolean } = {}) {
  const address = { search: start.search ?? '', hash: '' };
  const environment: AccountEnvironment = {
    search: () => address.search,
    hash: () => address.hash,
    replaceAddress(search, hash) {
      address.search = search;
      address.hash = hash;
    },
    storageKeys: () => start.keys ?? [],
    hasStoredSession: () => start.stored ?? false,
    redirectTo: () => `https://agora.test/${address.search}`,
  };
  return { environment, address };
}

function setup(
  server: ReturnType<typeof fakeServer>,
  env: ReturnType<typeof fakeEnvironment> = fakeEnvironment(),
) {
  const store = createAccountStore();
  const load = vi.fn(async () => server.session);
  const library = { enter: vi.fn(async () => true), leave: vi.fn() };
  const controller = createAccountController({
    store,
    load,
    environment: env.environment,
    library,
    now: () => 1_000,
  });
  return { store, load, library, controller, address: env.address };
}

describe('starting', () => {
  it('loads nothing for a guest', async () => {
    const { controller, load, store } = setup(fakeServer());
    await controller.start();
    expect(load).not.toHaveBeenCalled();
    expect(store.getState().status).toBe('signed-out');
  });

  it('resumes a stored session with a finished profile, and moves the library up', async () => {
    const server = fakeServer({ user: USER, profile: profileOf('heron_one', AGREED) });
    const { controller, store, library } = setup(server, fakeEnvironment({ stored: true }));
    await controller.start();
    await settle();
    expect(store.getState()).toMatchObject({
      status: 'signed-in',
      email: USER.email,
      profile: { handle: 'heron_one' },
      sheet: null,
    });
    expect(library.enter).toHaveBeenCalledTimes(1);
  });

  it('reads the profile once per user, not on every token refresh', async () => {
    const server = fakeServer({ user: USER, profile: profileOf('heron_one', AGREED) });
    const { controller } = setup(server, fakeEnvironment({ stored: true }));
    await controller.start();
    await settle();
    server.emit(USER);
    await settle();
    expect(server.account.myProfile).toHaveBeenCalledTimes(1);
  });

  it('finishes a sign-in return and cleans the address', async () => {
    const server = fakeServer({ user: USER, profile: profileOf('heron_one', AGREED) });
    const env = fakeEnvironment({
      search: '?cats=climate&code=abc&sb_flow_id=f1',
      keys: ['agora.auth.v1-flow-f1-code-verifier'],
    });
    const { controller, store, address } = setup(server, env);
    await controller.start();
    await settle();
    expect(address.search).toBe('?cats=climate');
    expect(store.getState().status).toBe('signed-in');
  });

  it('explains a link opened in another browser, without loading the SDK', async () => {
    const env = fakeEnvironment({ search: '?code=abc' });
    const { controller, store, load, address } = setup(fakeServer(), env);
    await controller.start();
    expect(load).not.toHaveBeenCalled();
    expect(store.getState().sheet).toBe('sign-in');
    expect(store.getState().notice).toMatch(/different browser/);
    expect(address.search).toBe('');
  });

  it('explains an expired link in its own words', async () => {
    const env = fakeEnvironment({
      search: '?error=access_denied&error_code=otp_expired&error_description=Call+555',
    });
    const { controller, store } = setup(fakeServer(), env);
    await controller.start();
    expect(store.getState().notice).toMatch(/expired or was already used/);
    expect(store.getState().notice).not.toMatch(/555/);
  });

  it('says so when a returned code did not sign anyone in', async () => {
    const env = fakeEnvironment({ search: '?code=stale', keys: ['agora.auth.v1-code-verifier'] });
    const { controller, store } = setup(fakeServer(), env);
    await controller.start();
    await settle();
    expect(store.getState().notice).toBe('Sign-in did not work. Please try again.');
  });
});

describe('signing in by email', () => {
  it('sends a link back to the same view, then signs in with the code', async () => {
    const server = fakeServer();
    const { controller, store } = setup(server, fakeEnvironment({ search: '?within=6' }));
    expect(await controller.sendEmailLink('  reader@test.example ')).toBe(true);
    expect(server.account.sendEmailLink).toHaveBeenCalledWith(
      'reader@test.example',
      'https://agora.test/?within=6',
    );
    expect(store.getState()).toMatchObject({ sentTo: 'reader@test.example', sentAtMs: 1_000 });

    expect(await controller.verifyEmailCode('123 456')).toBe(true);
    await settle();
    expect(store.getState()).toMatchObject({ status: 'setup', step: 'age', sheet: 'setup' });
  });

  it('keeps the reader on the code after a wrong one', async () => {
    const { controller, store } = setup(fakeServer());
    await controller.sendEmailLink('reader@test.example');
    expect(await controller.verifyEmailCode('000000')).toBe(false);
    expect(store.getState().notice).toMatch(/code is wrong or has expired/);
    expect(store.getState().sentTo).toBe('reader@test.example');
  });
});

describe('the first sign-in', () => {
  async function signedInNew() {
    const server = fakeServer();
    const harness = setup(server);
    await harness.controller.sendEmailLink('reader@test.example');
    await harness.controller.verifyEmailCode('123456');
    await settle();
    return { server, ...harness };
  }

  it('goes age, handle, rules, and only then moves the library up', async () => {
    const { controller, store, library, server } = await signedInNew();
    expect(library.enter).not.toHaveBeenCalled();

    await controller.answerAge(true);
    expect(store.getState().step).toBe('handle');
    expect(await controller.chooseHandle('heron_one')).toBe(true);
    expect(server.account.claimHandle).toHaveBeenCalledWith('heron_one', true);
    expect(store.getState()).toMatchObject({ step: 'rules', profile: { handle: 'heron_one' } });
    expect(library.enter).not.toHaveBeenCalled();

    expect(await controller.agreeToRules()).toBe(true);
    expect(library.enter).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ status: 'signed-in', sheet: null });
  });

  it('keeps the reader on the handle step when it was taken', async () => {
    const { controller, store } = await signedInNew();
    await controller.answerAge(true);
    expect(await controller.chooseHandle('taken_one')).toBe(false);
    expect(store.getState()).toMatchObject({ step: 'handle', status: 'setup' });
    expect(store.getState().notice).toMatch(/just taken/);
  });

  it('under 17: deletes the new account, signs out, and keeps the device library', async () => {
    const { controller, store, library, server } = await signedInNew();
    await controller.answerAge(false);
    await settle();
    expect(server.account.deleteAccount).toHaveBeenCalledTimes(1);
    expect(server.account.signOut).toHaveBeenCalledTimes(1);
    expect(library.enter).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({
      status: 'signed-out',
      step: 'under-age',
      sheet: 'setup',
      notice: UNDER_AGE_NOTICE,
    });
    store.getState().closeSheet();
    expect(store.getState().sheet).toBeNull();
  });

  it('cannot be closed, only left with Not now, which signs out', async () => {
    const { controller, store, library } = await signedInNew();
    store.getState().closeSheet();
    expect(store.getState().sheet).toBe('setup');
    await controller.notNow();
    await settle();
    expect(store.getState()).toMatchObject({ status: 'signed-out', sheet: null });
    expect(library.enter).not.toHaveBeenCalled();
  });

  it('resumes at the rules when the handle was chosen last time', async () => {
    const server = fakeServer({ user: USER, profile: profileOf('heron_one', null) });
    const { controller, store } = setup(server, fakeEnvironment({ stored: true }));
    await controller.start();
    await settle();
    expect(store.getState()).toMatchObject({ status: 'setup', step: 'rules', sheet: 'setup' });
  });

  it('asks again when the rules changed after the reader agreed', async () => {
    const server = fakeServer({
      user: USER,
      profile: profileOf('heron_one', RULES_UPDATED_AT_MS - 1),
    });
    const { controller, store } = setup(server, fakeEnvironment({ stored: true }));
    await controller.start();
    await settle();
    expect(store.getState()).toMatchObject({ status: 'setup', step: 'rules' });
  });
});

describe('a signed-in account', () => {
  async function signedIn() {
    const server = fakeServer({ user: USER, profile: profileOf('heron_one', AGREED) });
    const harness = setup(server, fakeEnvironment({ stored: true }));
    await harness.controller.start();
    await settle();
    return { server, ...harness };
  }

  it('signs out to the device library', async () => {
    const { controller, store, library } = await signedIn();
    store.getState().openAccount();
    await controller.signOut();
    await settle();
    expect(library.leave).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ status: 'signed-out', sheet: null, profile: null });
  });

  it('deletes the account, signs out and says so', async () => {
    const { controller, store, library, server } = await signedIn();
    store.getState().openAccount();
    expect(await controller.deleteAccount()).toBe(true);
    await settle();
    expect(server.account.deleteAccount).toHaveBeenCalledTimes(1);
    expect(server.profile()).toBeNull();
    expect(library.leave).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({
      status: 'signed-out',
      sheet: 'account',
      notice: DELETED_NOTICE,
    });
  });

  it('keeps the account when deletion fails, and says why', async () => {
    const { controller, store, server } = await signedIn();
    vi.mocked(server.account.deleteAccount).mockRejectedValueOnce(
      new AccountError('network', 'offline'),
    );
    expect(await controller.deleteAccount()).toBe(false);
    expect(store.getState().status).toBe('signed-in');
    expect(store.getState().notice).toMatch(/Could not reach the server/);
  });
});

describe('an unreachable account', () => {
  it('keeps the library on the device, then recovers on retry', async () => {
    const server = fakeServer({ user: USER, profile: profileOf('heron_one', AGREED) });
    server.failing.profile = true;
    const { controller, store, library } = setup(server, fakeEnvironment({ stored: true }));
    await controller.start();
    await settle();
    expect(store.getState()).toMatchObject({ status: 'unreachable', notice: UNREACHABLE_NOTICE });
    expect(library.enter).not.toHaveBeenCalled();

    server.failing.profile = false;
    await controller.retry();
    expect(store.getState().status).toBe('signed-in');
    expect(library.enter).toHaveBeenCalledTimes(1);
  });
});
