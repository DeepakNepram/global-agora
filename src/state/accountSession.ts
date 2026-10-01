import { AUTH_STORAGE_KEY } from '@/core';
import type { DbClient, DbConfig } from '@/core/db';

import { enterAccount, leaveAccount } from './library';
import { browserStorage, type KeyValueStorage } from './persist';

/**
 * The signed-in session, and with it the Supabase SDK (~54 kB gzip), which
 * loads only when there is a session to resume: a guest's cold start never
 * downloads it. Prompt 4.1's sign-in opens a session the same way.
 *
 * Signing in moves the device's library to the account (library.ts);
 * signing out returns to the device's.
 */

export interface AccountSession {
  readonly client: DbClient;
  dispose(): void;
}

/** True when the SDK left a session in storage: worth loading it to resume. */
export function hasStoredSession(storage: KeyValueStorage | null = browserStorage()): boolean {
  try {
    return storage?.getItem(AUTH_STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

export async function openAccountSession(config: DbConfig): Promise<AccountSession> {
  const db = await import('@/core/db');
  const client = db.createDbClient(config);
  const remote = db.createLibraryRemote(client);
  let userId: string | null = null;

  const { data } = client.auth.onAuthStateChange((_event, session) => {
    const next = session?.user.id ?? null;
    if (next === userId) return;
    userId = next;
    // Out of the callback: the SDK holds its auth lock while it runs, and a
    // query made inside would wait on that lock.
    setTimeout(() => {
      if (next === null) leaveAccount();
      else void enterAccount(remote);
    }, 0);
  });
  return { client, dispose: () => data.subscription.unsubscribe() };
}

/** Resumes a stored session on start; null (and no SDK) for a guest. */
export async function resumeAccountSession(
  config: DbConfig | null,
  storage: KeyValueStorage | null = browserStorage(),
): Promise<AccountSession | null> {
  if (config === null || !hasStoredSession(storage)) return null;
  return openAccountSession(config);
}
