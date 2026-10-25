/**
 * The checks behind `npm run deploy:check` (Prompt 5.2), pure so a test can
 * run them. Each looks at one variable the production build inlines and says
 * what is wrong with it, never what it is: findings are printed, values are
 * not.
 */

import { assertPublicKey } from '../../src/core/db/config.ts';

export type Level = 'ok' | 'warn' | 'error';

export interface Finding {
  readonly key: string;
  readonly level: Level;
  readonly note: string;
}

type EnvBag = Readonly<Record<string, string | undefined>>;

const PROVIDERS = new Set(['google', 'apple', 'email']);
/** Hosts that only exist on this laptop or in the browser checks. */
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$|\.(test|local|localhost)$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DSN = /^https:\/\/[0-9a-f]+@([a-z0-9.-]+)\/\d+$/i;

/**
 * Whether a CSP source list lets the page connect to `url`. Handles what
 * public/_headers uses: 'self', scheme://host and scheme://*.domain.
 */
export function cspAllows(sources: readonly string[], url: URL): boolean {
  return sources.some((source) => {
    const match = /^([a-z]+):\/\/(\*\.)?([^/:]+)$/i.exec(source);
    if (!match) return false;
    const [, scheme, wildcard, host] = match;
    if (`${scheme ?? ''}:` !== url.protocol) return false;
    return wildcard ? url.hostname.endsWith(`.${host ?? ''}`) : url.hostname === host;
  });
}

function read(env: EnvBag, key: string): string {
  return env[key]?.trim() ?? '';
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function needed(key: string, why: string): Finding {
  return { key, level: 'error', note: `missing: ${why}` };
}

function supabaseUrl(env: EnvBag, connect: readonly string[]): Finding {
  const key = 'VITE_SUPABASE_URL';
  const value = read(env, key);
  if (value === '') return needed(key, 'accounts and discussions need the hosted project');
  const url = parseUrl(value);
  if (url !== null && LOCAL_HOST.test(url.hostname)) {
    return { key, level: 'error', note: 'points at a local stack (.env.local leaking in?)' };
  }
  if (url === null || url.protocol !== 'https:') {
    return { key, level: 'error', note: 'not an https URL' };
  }
  const realtime = new URL(url.href.replace(/^https:/, 'wss:'));
  if (!cspAllows(connect, url) || !cspAllows(connect, realtime)) {
    return {
      key,
      level: 'error',
      note: "its host is not in public/_headers' connect-src (https and wss)",
    };
  }
  return { key, level: 'ok', note: 'hosted project, allowed by the CSP' };
}

function anonKey(env: EnvBag): Finding {
  const key = 'VITE_SUPABASE_ANON_KEY';
  const value = read(env, key);
  if (value === '') return needed(key, 'the publishable key goes with the URL');
  try {
    assertPublicKey(value);
  } catch (error) {
    return { key, level: 'error', note: error instanceof Error ? error.message : 'refused' };
  }
  return { key, level: 'ok', note: 'a publishable (public) key' };
}

function providers(env: EnvBag): Finding {
  const key = 'VITE_AUTH_PROVIDERS';
  const listed = read(env, key)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const unknown = listed.filter((item) => !PROVIDERS.has(item));
  if (unknown.length > 0) {
    return { key, level: 'error', note: `unknown: ${unknown.join(', ')} (google, apple, email)` };
  }
  if (listed.length === 0) return { key, level: 'ok', note: 'email sign-in only' };
  return { key, level: 'ok', note: `${listed.join(', ')}; each set up in Supabase Auth first` };
}

function apiBase(env: EnvBag, connect: readonly string[]): Finding {
  const key = 'VITE_API_BASE_URL';
  const value = read(env, key);
  if (value === '' || value.startsWith('/')) {
    return { key, level: 'ok', note: 'same origin: the API Worker routed on the Pages domain' };
  }
  const url = parseUrl(value);
  if (url !== null && LOCAL_HOST.test(url.hostname)) {
    return { key, level: 'error', note: 'points at a local Worker' };
  }
  if (url === null || url.protocol !== 'https:') {
    return { key, level: 'error', note: 'neither a path nor an https URL' };
  }
  if (!cspAllows(connect, url)) {
    return { key, level: 'error', note: "its host is not in public/_headers' connect-src" };
  }
  return { key, level: 'ok', note: 'a separate origin: set API_ALLOWED_ORIGINS on the Worker' };
}

function sentryDsn(env: EnvBag, connect: readonly string[]): Finding {
  const key = 'VITE_SENTRY_DSN';
  const value = read(env, key);
  if (value === '') {
    return { key, level: 'warn', note: 'unset: crash reports are off in this build' };
  }
  const host = DSN.exec(value)?.[1];
  if (host === undefined) return { key, level: 'error', note: 'not a Sentry DSN' };
  if (!cspAllows(connect, new URL(`https://${host}`))) {
    return { key, level: 'error', note: "its host is not in public/_headers' connect-src" };
  }
  return { key, level: 'ok', note: 'a Sentry DSN, allowed by the CSP' };
}

function contactEmail(env: EnvBag): Finding {
  const key = 'VITE_CONTACT_EMAIL';
  const value = read(env, key);
  if (value === '') return needed(key, 'the Contact page and the policies name a real inbox');
  if (!EMAIL.test(value)) return { key, level: 'error', note: 'not an email address' };
  if (/@(example\.(com|org|net)|[^@]*\.example)$/i.test(value)) {
    return { key, level: 'error', note: 'an example address, not a real inbox' };
  }
  return { key, level: 'ok', note: 'an email address (check that mail to it arrives)' };
}

function plain(env: EnvBag, key: string, why: string): Finding {
  return read(env, key) === '' ? needed(key, why) : { key, level: 'ok', note: 'set' };
}

/** Any build value pointing at this laptop, whichever variable it is in. */
function leaks(env: EnvBag): Finding[] {
  return Object.keys(env)
    .filter((key) => key.startsWith('VITE_'))
    .filter((key) => /\b(localhost|127\.0\.0\.1|e2e\.test)\b|:5432[1-9]\b/i.test(read(env, key)))
    .map((key) => ({ key, level: 'error' as const, note: 'holds a local address' }));
}

/** Every finding for a production build's env, given the CSP's connect-src sources. */
export function checkProductionEnv(env: EnvBag, connect: readonly string[]): Finding[] {
  const findings = [
    supabaseUrl(env, connect),
    anonKey(env),
    providers(env),
    apiBase(env, connect),
    sentryDsn(env, connect),
    contactEmail(env),
    plain(env, 'VITE_OPERATOR_NAME', 'the documents name who runs the service'),
    plain(env, 'VITE_OPERATOR_COUNTRY', 'the terms name the governing law'),
    plain(env, 'VITE_DATA_REGION', 'the privacy policy says where data is kept'),
  ];
  const named = new Set(findings.map((finding) => finding.key));
  return [...findings, ...leaks(env).filter((finding) => !named.has(finding.key))];
}

/** connect-src's sources from public/_headers' text. */
export function connectSources(headers: string): string[] {
  const list = /connect-src ([^;\n]*)/.exec(headers)?.[1] ?? '';
  return list.split(/\s+/).filter(Boolean);
}
