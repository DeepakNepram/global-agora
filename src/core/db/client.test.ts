import { describe, expect, it } from 'vitest';

import { assertPublicKey, createDbClient, dbConfigFromEnv } from './client';

/** An unsigned JWT with the given payload; only the payload matters to the guard. */
function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

const ANON = jwt({ iss: 'supabase-demo', role: 'anon', exp: 1983812996 });
const SERVICE = jwt({ iss: 'supabase-demo', role: 'service_role', exp: 1983812996 });
const URL = 'http://127.0.0.1:54321';

describe('assertPublicKey', () => {
  it('accepts the anon JWT and publishable keys', () => {
    expect(() => assertPublicKey(ANON)).not.toThrow();
    expect(() => assertPublicKey('sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH')).not.toThrow();
  });

  it('refuses the service-role JWT, naming why', () => {
    expect(() => assertPublicKey(SERVICE)).toThrow(/service_role.*row-level security/);
  });

  it('refuses secret keys and anything that is not a Supabase key', () => {
    // Built rather than written out: a real-looking secret key in the source
    // trips secret scanning, and no real key belongs in the repo.
    expect(() => assertPublicKey(`sb_secret_${'x'.repeat(31)}`)).toThrow(/secret/);
    expect(() => assertPublicKey('')).toThrow();
    expect(() => assertPublicKey('not-a-key')).toThrow();
    expect(() => assertPublicKey(jwt({ role: 'authenticated' }))).toThrow(/authenticated/);
  });
});

describe('dbConfigFromEnv', () => {
  it('reads the URL and anon key', () => {
    expect(
      dbConfigFromEnv({ VITE_SUPABASE_URL: ` ${URL} `, VITE_SUPABASE_ANON_KEY: ANON }),
    ).toEqual({ url: URL, anonKey: ANON });
  });

  it('returns null when Supabase is not configured', () => {
    expect(dbConfigFromEnv({})).toBeNull();
    expect(dbConfigFromEnv({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: '' })).toBeNull();
  });

  it('fails at startup when the env holds a service key', () => {
    expect(() =>
      dbConfigFromEnv({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: SERVICE }),
    ).toThrow(/service_role/);
  });
});

describe('createDbClient', () => {
  it('builds a typed client without touching the network', () => {
    const client = createDbClient({ url: URL, anonKey: ANON }, { persistSession: false });
    expect(typeof client.from).toBe('function');
  });

  it('refuses a service key even when called directly', () => {
    expect(() => createDbClient({ url: URL, anonKey: SERVICE })).toThrow(/service_role/);
  });

  it('refuses a non-http URL', () => {
    expect(() => createDbClient({ url: 'ftp://example.test', anonKey: ANON })).toThrow(/http/);
  });
});
