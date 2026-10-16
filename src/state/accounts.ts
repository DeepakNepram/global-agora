import { stripAuthParams } from '@/core';
import type { DbConfig } from '@/core/db/config';

import {
  createAccountController,
  type AccountController,
  type AccountEnvironment,
} from './accountController';
import { hasStoredSession, loadAccountSession, type AccountSession } from './accountSession';
import { accountStore } from './accountStore';
import { createUpdatesController, updatesStore, type UpdatesController } from './updates';

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
let currentUpdates: UpdatesController | null = null;

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

/** The reader's notices (Prompt 4.3), or null when this build has no backend. */
export function getUpdatesController(): UpdatesController | null {
  return currentUpdates;
}

/** Makes and starts the controller; the returned function stops it. */
export function startAccounts(config: DbConfig | null): () => void {
  if (config === null) return () => {};
  const load = (): Promise<AccountSession> => sharedSession(config);
  const controller = createAccountController({
    store: accountStore,
    load,
    environment: browserAccountEnvironment(),
  });
  const updates = createUpdatesController({ store: updatesStore, accounts: accountStore, load });
  current = controller;
  currentUpdates = updates;
  void controller.start();
  return () => {
    controller.dispose();
    updates.dispose();
    if (current === controller) current = null;
    if (currentUpdates === updates) currentUpdates = null;
  };
}
