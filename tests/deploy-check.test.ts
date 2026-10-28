import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  checkProductionEnv,
  connectSources,
  cspAllows,
  type Finding,
} from '../scripts/deploy/checks.ts';

const CONNECT = connectSources(readFileSync('public/_headers', 'utf8'));

/** A legacy anon JWT, made here so nothing key-shaped is committed (as scripts/e2e/build.ts). */
const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (role: string): string => [part({ alg: 'HS256' }), part({ role }), 'sig'].join('.');

const GOOD = {
  VITE_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  VITE_SUPABASE_ANON_KEY: jwt('anon'),
  VITE_AUTH_PROVIDERS: 'google,email',
  VITE_API_BASE_URL: '',
  VITE_SENTRY_DSN: 'https://0123456789abcdef@o42.ingest.de.sentry.io/4507',
  VITE_CONTACT_EMAIL: 'hello@agora.invalid',
  VITE_OPERATOR_NAME: 'Agora Operator',
  VITE_OPERATOR_COUNTRY: 'India',
  VITE_DATA_REGION: 'the EU (Frankfurt)',
};

function find(findings: readonly Finding[], key: string): Finding | undefined {
  return findings.find((finding) => finding.key === key);
}

describe('deploy:check', () => {
  it('passes a complete production env', () => {
    const findings = checkProductionEnv(GOOD, CONNECT);
    expect(findings.filter((finding) => finding.level !== 'ok')).toEqual([]);
  });

  it('never repeats a value in what it prints', () => {
    const notes = checkProductionEnv(GOOD, CONNECT)
      .map((finding) => finding.note)
      .join(' ');
    for (const value of Object.values(GOOD).filter((value) => value.length > 6)) {
      expect(notes).not.toContain(value);
    }
  });

  it('catches the local stack leaking in from .env.local', () => {
    const findings = checkProductionEnv(
      { ...GOOD, VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_OTHER: 'http://localhost:8788' },
      CONNECT,
    );
    expect(find(findings, 'VITE_SUPABASE_URL')).toMatchObject({ level: 'error' });
    expect(find(findings, 'VITE_SUPABASE_URL')?.note).toMatch(/local stack/);
    expect(find(findings, 'VITE_OTHER')).toMatchObject({ level: 'error' });
  });

  it('refuses a key that bypasses row-level security', () => {
    for (const key of [jwt('service_role'), `sb_secret_${'x'.repeat(31)}`]) {
      const findings = checkProductionEnv({ ...GOOD, VITE_SUPABASE_ANON_KEY: key }, CONNECT);
      expect(find(findings, 'VITE_SUPABASE_ANON_KEY')).toMatchObject({ level: 'error' });
    }
  });

  it('wants what the documents and Contact page name', () => {
    const findings = checkProductionEnv(
      {
        ...GOOD,
        VITE_CONTACT_EMAIL: 'hello@example.com',
        VITE_OPERATOR_NAME: ' ',
        VITE_DATA_REGION: undefined,
      },
      CONNECT,
    );
    expect(find(findings, 'VITE_CONTACT_EMAIL')?.note).toMatch(/example/);
    expect(find(findings, 'VITE_OPERATOR_NAME')).toMatchObject({ level: 'error' });
    expect(find(findings, 'VITE_DATA_REGION')).toMatchObject({ level: 'error' });
  });

  it('holds every origin to the CSP the page is served with', () => {
    const findings = checkProductionEnv(
      {
        ...GOOD,
        VITE_SUPABASE_URL: 'https://db.agora.invalid',
        VITE_API_BASE_URL: 'https://api.agora.invalid/api',
        VITE_SENTRY_DSN: 'https://0123abcd@sentry.agora.invalid/1',
      },
      CONNECT,
    );
    for (const key of ['VITE_SUPABASE_URL', 'VITE_API_BASE_URL', 'VITE_SENTRY_DSN']) {
      expect(find(findings, key)?.note, key).toMatch(/connect-src/);
    }
  });

  it('only warns when Sentry is unset, and checks the sign-in list', () => {
    const findings = checkProductionEnv(
      { ...GOOD, VITE_SENTRY_DSN: '', VITE_AUTH_PROVIDERS: 'google,github' },
      CONNECT,
    );
    expect(find(findings, 'VITE_SENTRY_DSN')).toMatchObject({ level: 'warn' });
    expect(find(findings, 'VITE_AUTH_PROVIDERS')?.note).toMatch(/github/);
  });

  it('matches CSP sources as browsers do', () => {
    const sources = ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'];
    expect(cspAllows(sources, new URL('https://x.supabase.co/rest'))).toBe(true);
    expect(cspAllows(sources, new URL('wss://x.supabase.co/realtime'))).toBe(true);
    expect(cspAllows(sources, new URL('https://supabase.co'))).toBe(false);
    expect(cspAllows(sources, new URL('https://x.supabase.co.evil.example'))).toBe(false);
    expect(cspAllows(sources, new URL('http://x.supabase.co'))).toBe(false);
  });
});
