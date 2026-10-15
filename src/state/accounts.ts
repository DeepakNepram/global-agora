import { stripAuthParams } from '@/core';
import type { DbConfig } from '@/core/db/config';

import {
  createAccountController,
  type AccountController,
  type AccountEnvironment,
} from './accountController';
import { hasStoredSession, loadAccountSession, type AccountSession } from './accountSession';
import { accountStore } from './accountStore';

/**
 * The app's one account controller, made at start when the build has a
 * backend. Without one (no Supabase settings), there is no Sign in at all and
 * everything a reader keeps lives on the device.
 */

export function browserAccountEnvironment(): AccountEnvironment {
  return {
    search: () => window.location.search,
    hash: () => window.location.hash,
    replaceAddress(search, hash) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${search}${hash}`,
      );
    },
    storageKeys() {
      try {
        const storage = window.localStorage;
        return Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '');
      } catch {
        return [];
      }
    },
    hasStoredSession: () => hasStoredSession(),
    // Back to the same view, filters included (the allow-list takes any path
    // and query on the app's own origin).
    redirectTo: () =>
      `${window.location.origin}${window.location.pathname}${stripAuthParams(window.location.search)}`,
  };
}

let current: AccountController | null = null;

/**
 * One SDK client per backend, however often the controller is remade
 * (React StrictMode mounts effects twice in development). Two clients on one
 * stored session would each exchange a returning sign-in code and each
 * refresh the token.
 */
const sessions = new Map<string, Promise<AccountSession>>();

function sharedSession(config: DbConfig): Promise<AccountSession> {
  const key = `${config.url} ${config.anonKey}`;
  let session = sessions.get(key);
  if (session === undefined) {
    session = loadAccountSession(config);
    // A chunk that failed to load is tried again next time.
    session.catch(() => sessions.delete(key));
    sessions.set(key, session);
  }
  return session;
}

/** The controller, or null when this build has no backend. */
export function getAccountController(): AccountController | null {
  return current;
}

/** Makes and starts the controller; the returned function stops it. */
export function startAccounts(config: DbConfig | null): () => void {
  if (config === null) return () => {};
  const controller = createAccountController({
    store: accountStore,
    load: () => sharedSession(config),
    environment: browserAccountEnvironment(),
  });
  current = controller;
  void controller.start();
  return () => {
    controller.dispose();
    if (current === controller) current = null;
  };
}
