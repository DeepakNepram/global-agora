import { AUTH_STORAGE_KEY, type AccountRemote, type LibraryRemote } from '@/core';
import type { DbConfig } from '@/core/db';

import { browserStorage, type KeyValueStorage } from './persist';

/**
 * The Supabase SDK (~54 kB gzip), loaded only when there is an account to
 * talk to: a stored session to resume, a sign-in to finish (the return from
 * an email link, Google or Apple), or a reader pressing Sign in. A guest's
 * cold start never downloads it.
 */

export interface SessionUser {
  readonly id: string;
  readonly email: string | null;
}

export interface AccountSession {
  readonly account: AccountRemote;
  readonly library: LibraryRemote;
  /** Calls back with the signed-in user (or null) now, then on every change. */
  onUser(listener: (user: SessionUser | null) => void): () => void;
  /** Once the SDK has read storage and the URL (a sign-in return is exchanged by then): who is signed in. */
  ready(): Promise<SessionUser | null>;
}

/** True when the SDK left a session in storage: worth loading it to resume. */
export function hasStoredSession(storage: KeyValueStorage | null = browserStorage()): boolean {
  try {
    return storage?.getItem(AUTH_STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

export async function loadAccountSession(config: DbConfig): Promise<AccountSession> {
  const db = await import('@/core/db');
  const client = db.createDbClient(config);
  const toUser = (
    session: { user: { id: string; email?: string | undefined } } | null,
  ): SessionUser | null =>
    session === null ? null : { id: session.user.id, email: session.user.email ?? null };

  return {
    account: db.createAccountRemote(client),
    library: db.createLibraryRemote(client),
    onUser(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        const user = toUser(session);
        // Out of the callback: the SDK holds its auth lock while it runs, and a
        // query made inside would wait on that lock.
        setTimeout(() => listener(user), 0);
      });
      return () => data.subscription.unsubscribe();
    },
    async ready() {
      const { data } = await client.auth.getSession();
      return toUser(data.session);
    },
  };
}
