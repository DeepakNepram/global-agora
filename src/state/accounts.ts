import { stripAuthParams } from '@/core';
import type { DbConfig } from '@/core/db/config';

import {
  createAccountController,
  type AccountController,
  type AccountEnvironment,
} from './accountController';
import { hasStoredSession, loadAccountSession } from './accountSession';
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

/** The controller, or null when this build has no backend. */
export function getAccountController(): AccountController | null {
  return current;
}

/** Makes and starts the controller; the returned function stops it. */
export function startAccounts(config: DbConfig | null): () => void {
  if (config === null) return () => {};
  const controller = createAccountController({
    store: accountStore,
    load: () => loadAccountSession(config),
    environment: browserAccountEnvironment(),
  });
  current = controller;
  void controller.start();
  return () => {
    controller.dispose();
    if (current === controller) current = null;
  };
}
