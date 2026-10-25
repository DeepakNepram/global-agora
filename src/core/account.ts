/**
 * Accounts (Prompt 4.1): signing in, the first sign-in's required setup, and
 * deleting the account. AccountRemote is what the app needs from Supabase
 * Auth and the profile functions (20261016100000_profiles.sql), implemented
 * over the SDK in db/account.ts, so src/state never sees the SDK and its
 * tests use a fake.
 *
 * Reading never needs an account. Signing in keeps a reader's follows and
 * saves in the account, across devices, and (from Prompt 4.2) lets them post
 * and vote.
 */

import type { AppealSummary } from './appeal';
import type { EnvBag } from './config';

export type OAuthProvider = 'google' | 'apple';
export type AuthProvider = OAuthProvider | 'email';

/** In the order the sign-in sheet shows them. */
const PROVIDER_ORDER: readonly AuthProvider[] = ['google', 'apple', 'email'];

/**
 * Which ways to sign in to offer: VITE_AUTH_PROVIDERS, comma separated
 * (`google,apple,email`). Each needs setting up in Supabase first (Google and
 * Apple need their own credentials), so the default is email alone.
 */
export function authProvidersFromEnv(env: EnvBag): AuthProvider[] {
  const raw = env['VITE_AUTH_PROVIDERS'];
  if (raw === undefined || raw.trim() === '') return ['email'];
  const listed = new Set(raw.split(',').map((name) => name.trim().toLowerCase()));
  return PROVIDER_ORDER.filter((provider) => listed.has(provider));
}

/** The signed-in account's own profile, private fields included (my_profile()). */
export interface Profile {
  readonly handle: string;
  readonly isAdult: boolean;
  /** When "I agree" was pressed, or null if never. */
  readonly rulesAcceptedAtMs: number | null;
  /** The monetization hook (CLAUDE.md); 'free' throughout v1. */
  readonly tier: string;
  readonly createdAtMs: number;
  /** Strikes for removed posts (Prompt 4.3); enough of them suspend. */
  readonly strikes: number;
  /** When posting, voting and taking sides were suspended, or null. */
  readonly suspendedAtMs: number | null;
  /** Whether this account moderates (the queue at /admin). */
  readonly isAdmin: boolean;
  /** The latest appeal (Prompt 5.2), or null if it never appealed. */
  readonly appeal: AppealSummary | null;
}

export type AccountErrorCode =
  /** The handle belongs to someone else. */
  | 'handle-taken'
  /** Not a valid handle, reserved, or the 17+ answer was missing. */
  | 'handle-invalid'
  /** The handle is fixed once the rules are agreed, or no profile exists yet. */
  | 'out-of-order'
  /** Too many emails or attempts; try again later. */
  | 'rate-limited'
  /** The 6-digit code is wrong or expired. */
  | 'bad-code'
  /** Not an email address the server accepts. */
  | 'bad-email'
  /** No account for that address, and sign-ups are off: the alpha is by invitation (Prompt 5.2). */
  | 'invite-only'
  /** An appeal is already waiting (Prompt 5.2). */
  | 'appeal-waiting'
  /** Not suspended, or too soon after a refusal. */
  | 'appeal-not-now'
  /** Empty, or over the limit. */
  | 'appeal-invalid'
  /** The session is gone (signed out elsewhere, or deleted). */
  | 'signed-out'
  /** The server could not be reached. */
  | 'network'
  | 'unknown';

export class AccountError extends Error {
  override readonly name: string = 'AccountError';
  // A plain field, not a parameter property: scripts/db/smoke.ts runs this
  // file under Node's type stripping, which does not support those.
  readonly code: AccountErrorCode;
  constructor(code: AccountErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface AccountRemote {
  /** Emails a sign-in link (with a 6-digit code) that returns to `redirectTo`. */
  sendEmailLink(email: string, redirectTo: string): Promise<void>;
  /** Signs in with the 6-digit code from that email. */
  verifyEmailCode(email: string, code: string): Promise<void>;
  /** Leaves for Google or Apple, which return to `redirectTo`. */
  startOAuth(provider: OAuthProvider, redirectTo: string): Promise<void>;
  /** Signs out on this device only. */
  signOut(): Promise<void>;
  /** The account's email, or null. */
  email(): Promise<string | null>;
  /** Null until the first setup has made one. */
  myProfile(): Promise<Profile | null>;
  /** Which of these (up to ten) could be claimed now. */
  handlesAvailable(handles: readonly string[]): Promise<string[]>;
  /** Makes the profile, or changes its handle until the rules are agreed. */
  claimHandle(handle: string, isAdult: boolean): Promise<void>;
  /** "I agree": returns when the database recorded it. */
  acceptRules(): Promise<number>;
  /** Deletes the account and everything in it, for good. */
  deleteAccount(): Promise<void>;
  /** Appeals the account's suspension (Prompt 5.2). */
  submitAppeal(body: string): Promise<void>;
}
