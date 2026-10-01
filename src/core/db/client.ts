/**
 * The typed Supabase client, and the only place in src/ that creates one.
 *
 * It takes the anon (publishable) key and nothing else (config.ts guards it).
 * The SDK costs ~54 kB gzip. Nothing imports this module at startup; the app
 * loads it with a dynamic import only once someone is signed in, so a
 * guest's cold start never pays for it (docs/DECISIONS.md).
 */
import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';

// Explicit .ts: scripts/db/smoke.ts loads this under plain Node, which needs it.
import { AUTH_STORAGE_KEY } from '../auth.ts';
import { assertPublicKey, type DbConfig } from './config.ts';
import type { Database } from './types';

export { assertPublicKey, dbConfigFromEnv } from './config.ts';
export type { DbConfig } from './config.ts';

export type DbClient = ReturnType<typeof createClient<Database>>;

type AuthOptions = NonNullable<SupabaseClientOptions<'public'>['auth']>;

export interface DbClientOptions {
  /** Where the signed-in session lives. Defaults to the SDK's choice (localStorage in browsers). */
  readonly storage?: AuthOptions['storage'];
  /** False for scripts and tests that must not keep a session around. */
  readonly persistSession?: boolean;
}

export function createDbClient(config: DbConfig, options: DbClientOptions = {}): DbClient {
  assertPublicKey(config.anonKey);
  if (!/^https?:\/\//.test(config.url)) {
    throw new Error(`Supabase URL must be http(s): ${config.url}`);
  }

  // A fixed key, so the app can tell a session is stored without the SDK.
  const auth: AuthOptions = { storageKey: AUTH_STORAGE_KEY };
  if (options.storage !== undefined) auth.storage = options.storage;
  if (options.persistSession !== undefined) auth.persistSession = options.persistSession;
  return createClient<Database>(config.url, config.anonKey, { auth });
}
