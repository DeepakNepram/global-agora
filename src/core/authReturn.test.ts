import { describe, expect, it } from 'vitest';

import {
  authReturnProblem,
  isCodeVerifierKey,
  readAuthReturn,
  stripAuthHash,
  stripAuthParams,
} from './authReturn';

describe('readAuthReturn', () => {
  it('sees nothing on an ordinary page', () => {
    expect(readAuthReturn('', '')).toEqual({ kind: 'none' });
    expect(readAuthReturn('?cats=climate&within=6', '')).toEqual({ kind: 'none' });
  });

  it('sees a PKCE code', () => {
    expect(readAuthReturn('?cats=climate&code=abc-123&sb_flow_id=f1', '')).toEqual({
      kind: 'code',
    });
  });

  it('sees an error in the query or the hash, by code', () => {
    expect(
      readAuthReturn(
        '?error=access_denied&error_code=otp_expired&error_description=Email+link',
        '',
      ),
    ).toEqual({ kind: 'error', code: 'otp_expired' });
    expect(readAuthReturn('', '#error=access_denied&error_description=cancelled')).toEqual({
      kind: 'error',
      code: 'access_denied',
    });
  });

  it('prefers an error over a code', () => {
    expect(readAuthReturn('?code=abc&error=server_error', '')).toEqual({
      kind: 'error',
      code: 'server_error',
    });
  });

  it('ignores a broken escape rather than throwing', () => {
    expect(readAuthReturn('?%E0%A4%A=1', '')).toEqual({ kind: 'none' });
  });
});

describe('stripAuthParams', () => {
  it('removes the sign-in fields and keeps the rest exactly as written', () => {
    expect(stripAuthParams('?cats=climate,tech&code=abc&sb_flow_id=f1&cam=1.5,2.5,800')).toBe(
      '?cats=climate,tech&cam=1.5,2.5,800',
    );
    expect(
      stripAuthParams('?error=access_denied&error_code=otp_expired&error_description=x&within=6'),
    ).toBe('?within=6');
  });

  it('returns an empty string when nothing is left', () => {
    expect(stripAuthParams('?code=abc')).toBe('');
    expect(stripAuthParams('')).toBe('');
  });
});

describe('stripAuthHash', () => {
  it('drops a hash that carries a sign-in error, and keeps any other', () => {
    expect(stripAuthHash('#error=access_denied&error_description=x')).toBe('');
    expect(stripAuthHash('#globe')).toBe('#globe');
  });
});

describe('isCodeVerifierKey', () => {
  it("matches the SDK's verifier keys under our storage key", () => {
    expect(isCodeVerifierKey('agora.auth.v1-code-verifier')).toBe(true);
    expect(isCodeVerifierKey('agora.auth.v1-flow-7f3a-code-verifier')).toBe(true);
  });

  it('does not match the session itself or anything else', () => {
    expect(isCodeVerifierKey('agora.auth.v1')).toBe(false);
    expect(isCodeVerifierKey('agora.auth.v1-user')).toBe(false);
    expect(isCodeVerifierKey('sb-127-auth-token-code-verifier')).toBe(false);
  });
});

describe('authReturnProblem', () => {
  it('uses our own words for known codes', () => {
    expect(authReturnProblem('otp_expired')).toMatch(/expired or was already used/);
    expect(authReturnProblem('access_denied')).toBe('Sign-in was cancelled.');
    expect(authReturnProblem('missing_verifier')).toMatch(/different browser/);
    // Google or Apple for an address with no account, while sign-ups are off.
    expect(authReturnProblem('signup_disabled')).toMatch(/invite-only/);
  });

  it('never repeats text from the URL', () => {
    expect(authReturnProblem('call_this_number_now')).toBe(
      'Sign-in did not work. Please try again.',
    );
    expect(authReturnProblem(null)).toBe('Sign-in did not work. Please try again.');
  });
});
