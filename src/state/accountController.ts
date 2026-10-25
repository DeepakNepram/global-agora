import {
  authReturnProblem,
  isCodeVerifierKey,
  needsRulesAgreement,
  readAuthReturn,
  stripAuthHash,
  stripAuthParams,
  type Profile,
} from '@/core';

import type { AccountState } from './accountStore';
import type { AccountController, AccountControllerOptions, LibraryLink } from './accountTypes';
import type { AccountSession, SessionUser } from './accountSession';
import { wallClockNow } from './clock';
import {
  accountProblem,
  UNDER_AGE_NOTICE,
  UNREACHABLE_NOTICE,
  DELETED_NOTICE,
} from './accountMessages';
import { enterAccount, leaveAccount } from './library';

export type {
  AccountController,
  AccountControllerOptions,
  AccountEnvironment,
  LibraryLink,
} from './accountTypes';

/**
 * Signing in, the first sign-in's required setup, and deleting the account
 * (Prompt 4.1). The screen reads accountStore; this writes it.
 *
 * The device's library moves up only once setup is finished. An under-17
 * answer deletes the new account, and a reader who leaves setup is signed
 * out, so in neither case has anything left the device (nothing lost).
 */

export function createAccountController(options: AccountControllerOptions): AccountController {
  const { store, load, environment: env } = options;
  const library: LibraryLink = options.library ?? {
    enter: (remote) => enterAccount(remote),
    leave: () => leaveAccount(),
  };
  const now = options.now ?? wallClockNow;
  let session: Promise<AccountSession> | null = null;
  let unsubscribe: (() => void) | null = null;
  let user: SessionUser | null = null;
  /** Bumped on every change of user, so a slow reply about the last one is dropped. */
  let generation = 0;
  let disposed = false;

  const set = (partial: Partial<AccountState>): void => store.setState(partial);

  function connect(): Promise<AccountSession> {
    if (session === null) {
      const loading = load().then((loaded) => {
        const stop = loaded.onUser((next) => void onUser(loaded, next));
        if (disposed) stop();
        else unsubscribe = stop;
        return loaded;
      });
      // A chunk that failed to load can be tried again on the next press.
      loading.catch(() => {
        if (session === loading) session = null;
      });
      session = loading;
    }
    return session;
  }

  /** Signed in with a finished profile: move the library up and show the account. */
  async function finish(loaded: AccountSession, profile: Profile, mine: number): Promise<void> {
    set({ status: 'loading', profile, busy: true });
    await library.enter(loaded.library);
    if (mine !== generation) return;
    const { sheet } = store.getState();
    set({
      status: 'signed-in',
      busy: false,
      sentTo: null,
      sentAtMs: null,
      sheet: sheet === 'sign-in' || sheet === 'setup' ? null : sheet,
    });
  }

  /** Where this account stands: setup to finish, or ready. */
  async function settle(loaded: AccountSession, mine: number): Promise<void> {
    set({ status: 'loading', busy: true, notice: null });
    let profile: Profile | null;
    try {
      profile = await loaded.account.myProfile();
    } catch {
      if (mine === generation)
        set({ status: 'unreachable', busy: false, notice: UNREACHABLE_NOTICE });
      return;
    }
    if (mine !== generation) return;
    if (profile === null || !profile.isAdult) {
      set({ status: 'setup', profile, step: 'age', sheet: 'setup', busy: false });
    } else if (needsRulesAgreement(profile.rulesAcceptedAtMs)) {
      set({ status: 'setup', profile, step: 'rules', sheet: 'setup', busy: false });
    } else {
      await finish(loaded, profile, mine);
    }
  }

  async function onUser(loaded: AccountSession, next: SessionUser | null): Promise<void> {
    if (disposed || (next?.id ?? null) === (user?.id ?? null)) return;
    user = next;
    const mine = ++generation;
    if (next === null) {
      library.leave();
      const { sheet, step } = store.getState();
      // Setup needs an account; its under-17 ending is the exception, said after it is gone.
      const keep = sheet !== 'setup' || step === 'under-age';
      set({
        status: 'signed-out',
        profile: null,
        email: null,
        busy: false,
        sheet: keep ? sheet : null,
      });
      return;
    }
    set({ email: next.email });
    await settle(loaded, mine);
  }

  /** Runs one request for the reader: busy while it runs, a notice if it fails. */
  async function attempt<T>(run: (loaded: AccountSession) => Promise<T>): Promise<T | null> {
    set({ busy: true, notice: null });
    try {
      const result = await run(await connect());
      set({ busy: false });
      return result;
    } catch (error) {
      set({ busy: false, notice: accountProblem(error) });
      return null;
    }
  }

  function cleanAddress(): void {
    env.replaceAddress(stripAuthParams(env.search()), stripAuthHash(env.hash()));
  }

  return {
    async start() {
      const back = readAuthReturn(env.search(), env.hash());
      const pending = back.kind === 'code' && env.storageKeys().some(isCodeVerifierKey);
      if (back.kind === 'error' || (back.kind === 'code' && !pending)) {
        const code = back.kind === 'error' ? back.code : 'missing_verifier';
        set({ sheet: 'sign-in', notice: authReturnProblem(code) });
        cleanAddress();
      }
      if (!pending && !env.hasStoredSession()) return;
      try {
        const loaded = await connect();
        const signedIn = await loaded.ready();
        if (pending) {
          cleanAddress();
          if (signedIn === null) set({ sheet: 'sign-in', notice: authReturnProblem(null) });
        }
      } catch {
        // The SDK did not load: the library stays on the device and reading goes on.
      }
    },

    async sendEmailLink(email) {
      const address = email.trim();
      const sent = await attempt((loaded) =>
        loaded.account.sendEmailLink(address, env.redirectTo()).then(() => true),
      );
      if (sent) set({ sentTo: address, sentAtMs: now() });
      return sent === true;
    },

    async verifyEmailCode(code) {
      const { sentTo } = store.getState();
      if (sentTo === null) return false;
      const ok = await attempt((loaded) =>
        loaded.account.verifyEmailCode(sentTo, code.replace(/\s/g, '')).then(() => true),
      );
      return ok === true;
    },

    async startOAuth(provider) {
      // On success the page leaves for the provider, so only a failure lands here.
      await attempt((loaded) => loaded.account.startOAuth(provider, env.redirectTo()));
    },

    async answerAge(adult) {
      if (adult) {
        set({ step: 'handle', notice: null });
        return;
      }
      // Said before the account goes, so signing out keeps the sheet open on it.
      set({ step: 'under-age', notice: UNDER_AGE_NOTICE, busy: true });
      try {
        const loaded = await connect();
        await loaded.account.deleteAccount().catch(() => undefined);
        await loaded.account.signOut().catch(() => undefined);
      } finally {
        set({ busy: false });
      }
    },

    async handlesAvailable(handles) {
      try {
        return await (await connect()).account.handlesAvailable(handles);
      } catch {
        return [];
      }
    },

    async chooseHandle(handle) {
      const profile = await attempt(async (loaded) => {
        await loaded.account.claimHandle(handle, true);
        return loaded.account.myProfile();
      });
      if (profile === null) return false;
      set({ profile, step: 'rules' });
      return true;
    },

    backToHandle() {
      set({ step: 'handle', notice: null });
    },

    async agreeToRules() {
      const mine = generation;
      const loaded = await attempt(async (current) => {
        await current.account.acceptRules();
        return current;
      });
      if (loaded === null) return false;
      const profile = await loaded.account.myProfile().catch(() => null);
      if (profile === null) {
        set({ notice: accountProblem(null) });
        return false;
      }
      await finish(loaded, profile, mine);
      return true;
    },

    async notNow() {
      set({ sheet: null, notice: null });
      await attempt((loaded) => loaded.account.signOut());
    },

    async signOut() {
      const done = await attempt((loaded) => loaded.account.signOut().then(() => true));
      if (done) set({ sheet: null });
    },

    async deleteAccount() {
      const done = await attempt((loaded) => loaded.account.deleteAccount().then(() => loaded));
      if (done === null) return false;
      // The account is gone; its session goes too, wherever the server's copy stands.
      await done.account.signOut().catch(() => undefined);
      set({ notice: DELETED_NOTICE });
      return true;
    },

    async sendAppeal(body) {
      const profile = await attempt(async (loaded) => {
        await loaded.account.submitAppeal(body.trim());
        return loaded.account.myProfile();
      });
      if (profile === null) return false;
      set({ profile });
      return true;
    },

    async retry() {
      if (session === null || user === null) return;
      await settle(await session, generation);
    },

    dispose() {
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
