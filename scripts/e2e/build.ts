/**
 * Builds the app for the browser checks (tests/e2e, Prompt 5.1): the
 * production build, pointed at a Supabase that only the checks' stand-in
 * answers (tests/e2e/fixtures/backend.ts), with every sign-in way shown.
 *
 *   npm run test:e2e:build      writes dist-e2e/
 *
 * The anon key is made here, at run time: an unsigned token whose role is
 * anon, which the client accepts as public and the stand-in never checks.
 * Nothing key-shaped is committed.
 */

import { spawnSync } from 'node:child_process';

export const E2E_SUPABASE_URL = 'http://supabase.e2e.test';
export const E2E_OUT_DIR = 'dist-e2e';

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const anonKey = [base64url({ alg: 'none', typ: 'JWT' }), base64url({ role: 'anon' }), 'e2e'].join(
  '.',
);

const result = spawnSync(
  'npx',
  ['vite', 'build', '--mode', 'production', '--outDir', E2E_OUT_DIR, '--emptyOutDir'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: E2E_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: anonKey,
      VITE_AUTH_PROVIDERS: 'google,apple,email',
      VITE_API_BASE_URL: '/api',
    },
  },
);
process.exit(result.status ?? 1);
