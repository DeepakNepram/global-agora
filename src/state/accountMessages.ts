import { AccountError, INVITE_ONLY_MESSAGE } from '@/core';

/**
 * What the account side says to the reader (Prompt 4.1), in our own words:
 * never the server's error text, which can be anything.
 */

export const DELETED_NOTICE =
  'Your account and everything in it were deleted. You can keep reading, following and saving ' +
  'on this device.';
export const UNDER_AGE_NOTICE =
  'Global Agora accounts are for people 17 and older, so we did not keep one for you. You can ' +
  'keep reading, following and saving on this device.';
export const UNREACHABLE_NOTICE =
  'Could not reach your account. Your follows and saves stay on this device for now.';

/** What to tell the reader about a failure, in our words. */
export function accountProblem(error: unknown): string {
  const code = error instanceof AccountError ? error.code : 'network';
  switch (code) {
    case 'handle-taken':
      return 'That handle was just taken. Pick another.';
    case 'handle-invalid':
      return 'That handle cannot be used. Pick another.';
    case 'out-of-order':
      return 'Your account changed in the meantime. Please try again.';
    case 'rate-limited':
      return 'Too many tries. Wait a minute, then try again.';
    case 'bad-code':
      return 'That code is wrong or has expired. Check the email, or ask for a new one.';
    case 'bad-email':
      return 'That does not look like an email address.';
    case 'invite-only':
      return INVITE_ONLY_MESSAGE;
    case 'signed-out':
      return 'You were signed out. Please sign in again.';
    case 'network':
      return 'Could not reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
