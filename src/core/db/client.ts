/**
 * The typed Supabase client, and the only place in src/ that touches the SDK.
 *
 * It takes the anon (publishable) key and nothing else. That key ships inside
 * the public bundle, which is safe only because every table has RLS and
 * explicit grants (docs/DATA_SCHEMA.md). A service-role or secret key bypasses
 * all of that, so createDbClient refuses one outright: a misplaced secret fails
 * the first time the app starts instead of shipping to every visitor
 * (CLAUDE.md #9).
 *
 * The SDK costs ~54 kB gzip. Nothing imports this module at startup; features
 * that need it load it with a dynamic import so the globe's cold start does
 * not pay for it (docs/DECISIONS.md).
 */
import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';

import type { EnvBag } from '../config';
import type { Database } from './types';

export type DbClient = ReturnType<typeof createClient<Database>>;

export interface DbConfig {
  readonly url: string;
  /** The anon JWT or an `sb_publishable_` key. Never a service or secret key. */
  readonly anonKey: string;
}

type AuthOptions = NonNullable<SupabaseClientOptions<'public'>['auth']>;

export interface DbClientOptions {
  /** Where the signed-in session lives. Defaults to the SDK's choice (localStorage in browsers). */
  readonly storage?: AuthOptions['storage'];
  /** False for scripts and tests that must not keep a session around. */
  readonly persistSession?: boolean;
}

/** Decodes a JWT's payload and returns its `role` claim, or null if it is not a JWT. */
function jwtRole(token: string): string | null {
  const segment = token.split('.')[1];
  if (segment === undefined) return null;
  try {
    const base64 = segment.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const payload: unknown = JSON.parse(atob(padded));
    if (typeof payload !== 'object' || payload === null || !('role' in payload)) return null;
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Throws unless `key` is safe to embed in the client: an `sb_publishable_` key
 * or a legacy JWT whose role is `anon`.
 */
export function assertPublicKey(key: string): void {
  if (key.startsWith('sb_publishable_')) return;
  if (key.startsWith('sb_secret_')) {
    throw new Error('Refusing a Supabase secret key in the client. Use the publishable key.');
  }
  const role = jwtRole(key);
  if (role === 'anon') return;
  if (role === null) {
    throw new Error('Not a Supabase anon or publishable key.');
  }
  throw new Error(
    `Refusing a Supabase '${role}' key in the client: it bypasses row-level security. ` +
      'Only the anon key belongs here; service keys live in Workers.',
  );
}

/**
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from an env bag. Returns
 * null when either is unset, so the app can run without a backend (the globe
 * does not need one until Prompt 2.3). The key is checked here too, so a bad
 * env fails at startup, not at the first query.
 */
export function dbConfigFromEnv(env: EnvBag): DbConfig | null {
  const url = env['VITE_SUPABASE_URL']?.trim() ?? '';
  const anonKey = env['VITE_SUPABASE_ANON_KEY']?.trim() ?? '';
  if (url === '' || anonKey === '') return null;
  assertPublicKey(anonKey);
  return { url, anonKey };
}

export function createDbClient(config: DbConfig, options: DbClientOptions = {}): DbClient {
  assertPublicKey(config.anonKey);
  if (!/^https?:\/\//.test(config.url)) {
    throw new Error(`Supabase URL must be http(s): ${config.url}`);
  }

  const auth: AuthOptions = {};
  if (options.storage !== undefined) auth.storage = options.storage;
  if (options.persistSession !== undefined) auth.persistSession = options.persistSession;
  return createClient<Database>(config.url, config.anonKey, { auth });
}
