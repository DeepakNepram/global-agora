import { describe, expect, it } from 'vitest';

import { accountErrorCode } from './account';

describe('accountErrorCode', () => {
  it("names the profile functions' errors", () => {
    expect(accountErrorCode({ message: 'dup', code: '23505' })).toBe('handle-taken');
    expect(accountErrorCode({ message: 'bad', code: '22023' })).toBe('handle-invalid');
    expect(accountErrorCode({ message: 'later', code: '55000' })).toBe('out-of-order');
    expect(accountErrorCode({ message: 'denied', code: '42501' })).toBe('signed-out');
    expect(accountErrorCode({ message: 'jwt expired', code: 'PGRST301' })).toBe('signed-out');
  });

  it("names Auth's errors", () => {
    expect(accountErrorCode({ message: 'slow down', status: 429 })).toBe('rate-limited');
    expect(
      accountErrorCode({ message: 'x', code: 'over_email_send_rate_limit', status: 400 }),
    ).toBe('rate-limited');
    expect(accountErrorCode({ message: 'expired', code: 'otp_expired', status: 403 })).toBe(
      'bad-code',
    );
    expect(accountErrorCode({ message: 'x', code: 'email_address_invalid', status: 400 })).toBe(
      'bad-email',
    );
  });

  it('tells a network failure from anything else', () => {
    expect(accountErrorCode({ message: 'x', name: 'AuthRetryableFetchError', status: 0 })).toBe(
      'network',
    );
    expect(accountErrorCode({ message: 'TypeError: Failed to fetch', code: '' })).toBe('network');
    expect(accountErrorCode({ message: 'something new', code: 'XX000' })).toBe('unknown');
  });
});
