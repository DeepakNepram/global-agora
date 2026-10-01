/**
 * The Supabase settings and the guard on its key, apart from client.ts so
 * they can be read at startup without loading the SDK (~54 kB gzip): the app
 * decides from these, and from whether a session is stored, whether it needs
 * the SDK at all. Guests never do.
 *
 * The key must be the anon (publishable) key. It ships inside the public
 * bundle, which is safe only because every table has RLS and explicit grants
 * (docs/DATA_SCHEMA.md). A service-role or secret key bypasses all of that,
 * so it is refused outright: a misplaced secret fails the first time the app
 * starts instead of shipping to every visitor (CLAUDE.md #9).
 */

import type { EnvBag } from '../config';

export interface DbConfig {
  readonly url: string;
  /** The anon JWT or an `sb_publishable_` key. Never a service or secret key. */
  readonly anonKey: string;
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
 * null when either is unset, so the app runs without a backend: everything a
 * guest does lives on the device. The key is checked here too, so a bad env
 * fails at startup, not at the first query.
 */
export function dbConfigFromEnv(env: EnvBag): DbConfig | null {
  const url = env['VITE_SUPABASE_URL']?.trim() ?? '';
  const anonKey = env['VITE_SUPABASE_ANON_KEY']?.trim() ?? '';
  if (url === '' || anonKey === '') return null;
  assertPublicKey(anonKey);
  return { url, anonKey };
}
