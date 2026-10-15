/**
 * Coming back from a sign-in: an email link, Google or Apple returns the
 * reader to the app with the outcome in the address bar (PKCE flow, so a
 * one-time code, never a token).
 *
 *   ?code=…&sb_flow_id=…                     signed in; the SDK exchanges the code
 *   ?error=…&error_code=otp_expired&…        the link failed (or #error=… in the hash)
 *
 * The app reads this at start without the SDK, to decide whether to load it.
 * Error text from the URL is never shown: anyone can craft a link with any
 * error_description, so the reader sees only our own words for known codes.
 */

import { AUTH_STORAGE_KEY } from './auth';

export type AuthReturn =
  | { readonly kind: 'none' }
  | { readonly kind: 'code' }
  | { readonly kind: 'error'; readonly code: string | null };

const CODE_PARAMS: readonly string[] = ['code', 'sb_flow_id'];
const ERROR_PARAMS: readonly string[] = ['error', 'error_code', 'error_description'];

/** One field's value from a query string or hash, or null. Malformed escapes count as absent. */
function field(raw: string, name: string): string | null {
  for (const part of raw.replace(/^[?#]/, '').split('&')) {
    const [key = '', value = ''] = part.split('=');
    try {
      if (decodeURIComponent(key) === name) return decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      // A broken escape is not ours to explain.
    }
  }
  return null;
}

export function readAuthReturn(search: string, hash: string): AuthReturn {
  for (const raw of [search, hash]) {
    if (field(raw, 'error') !== null || field(raw, 'error_code') !== null) {
      return { kind: 'error', code: field(raw, 'error_code') ?? field(raw, 'error') };
    }
  }
  return field(search, 'code') !== null ? { kind: 'code' } : { kind: 'none' };
}

/** The query string without the sign-in fields; the others are kept as written. */
export function stripAuthParams(search: string): string {
  const ours = [...CODE_PARAMS, ...ERROR_PARAMS];
  const parts = search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => {
      if (part === '') return false;
      try {
        return !ours.includes(decodeURIComponent(part.split('=')[0] ?? ''));
      } catch {
        return true;
      }
    });
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

/** The hash without a sign-in error; the app keeps nothing else there. */
export function stripAuthHash(hash: string): string {
  return ERROR_PARAMS.some((name) => field(hash, name) !== null) ? '' : hash;
}

/**
 * Whether a storage key is a PKCE code verifier the SDK left when sign-in
 * started (`agora.auth.v1-code-verifier`, or one per flow:
 * `agora.auth.v1-flow-<id>-code-verifier`). A code in the URL with no
 * verifier means the link was opened in another browser.
 */
export function isCodeVerifierKey(key: string): boolean {
  return key.startsWith(`${AUTH_STORAGE_KEY}-`) && key.endsWith('code-verifier');
}

/** What to tell the reader about a failed return. Our words only, by code. */
export function authReturnProblem(code: string | null): string {
  switch (code) {
    case 'otp_expired':
      return 'That sign-in link has expired or was already used. Ask for a new one.';
    case 'access_denied':
      return 'Sign-in was cancelled.';
    case 'missing_verifier':
      return (
        'That sign-in link was opened in a different browser. Open it in the browser where you ' +
        'asked for it, or type the 6-digit code from the email there.'
      );
    default:
      return 'Sign-in did not work. Please try again.';
  }
}
