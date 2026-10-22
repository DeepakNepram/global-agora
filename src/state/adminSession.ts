import type { AccountRemote } from '@/core';
// Directly, not through the barrels: only the /admin chunk carries these.
import type { AdminConsoleRemote } from '@/core/admin';
import type { DbConfig } from '@/core/db';
import type { AdminRemote } from '@/core/moderationQueue';

/**
 * The /admin pages' one connection (Prompts 4.3, 4.6). The page signs in
 * nowhere: it reads the session the reader made on the globe (the same
 * storage key), and the database decides who is an admin. Every tab shares
 * it, so there is one auth client refreshing one token.
 */
export interface AdminSession {
  readonly account: AccountRemote;
  /** The moderation queue (4.3). */
  readonly admin: AdminRemote;
  /** The hot stories, the counters and the locations (4.6). */
  readonly console: AdminConsoleRemote;
  /** Whether a reader is signed in on this device. */
  signedIn(): Promise<boolean>;
}

export async function loadAdminSession(config: DbConfig): Promise<AdminSession> {
  const db = await import('@/core/db');
  const client = db.createDbClient(config);
  return {
    account: db.createAccountRemote(client),
    admin: db.createAdminRemote(client),
    console: db.createAdminConsoleRemote(client),
    async signedIn() {
      const { data } = await client.auth.getSession();
      return data.session !== null;
    },
  };
}

/** One session per page, made on first use; a failed load is forgotten so a retry can work. */
export function sharedSession(load: () => Promise<AdminSession>): () => Promise<AdminSession> {
  let session: Promise<AdminSession> | null = null;
  return () => {
    session ??= load().catch((error: unknown) => {
      session = null;
      throw error;
    });
    return session;
  };
}
