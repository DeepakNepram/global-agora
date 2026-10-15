/**
 * The account over Supabase: Auth for signing in (PKCE, client.ts) and the
 * profile functions of 20261016100000_profiles.sql, which act only for the
 * caller. Errors become AccountErrors with a code the UI can explain, never
 * the server's own text.
 */

// Explicit .ts: scripts/db/smoke.ts loads this under plain Node, which needs it.
import {
  AccountError,
  type AccountErrorCode,
  type AccountRemote,
  type OAuthProvider,
  type Profile,
} from '../account.ts';
import type { DbClient } from './client';

interface ServerError {
  readonly message: string;
  readonly code?: string | undefined;
  readonly status?: number | undefined;
  readonly name?: string | undefined;
}

/** Postgres codes from the profile functions, and Auth's error codes, as ours. */
export function accountErrorCode(error: ServerError): AccountErrorCode {
  const code = error.code ?? '';
  if (code === '23505') return 'handle-taken';
  if (code === '22023') return 'handle-invalid';
  if (code === '55000') return 'out-of-order';
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST303') return 'signed-out';
  if (error.status === 429 || code.includes('rate_limit')) return 'rate-limited';
  if (code === 'otp_expired') return 'bad-code';
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'bad-email';
  if (code === 'session_not_found' || code === 'user_not_found') return 'signed-out';
  if (
    error.name === 'AuthRetryableFetchError' ||
    error.status === 0 ||
    /failed to fetch|network/i.test(error.message)
  ) {
    return 'network';
  }
  return 'unknown';
}

function fail(action: string, error: ServerError | null): void {
  if (error) throw new AccountError(accountErrorCode(error), `${action}: ${error.message}`);
}

interface ProfileRow {
  readonly handle: string;
  readonly is_adult: boolean;
  readonly rules_accepted_at: string | null;
  readonly tier: string;
  readonly created_at: string;
}

function toProfile(row: ProfileRow): Profile {
  return {
    handle: row.handle,
    isAdult: row.is_adult,
    rulesAcceptedAtMs: row.rules_accepted_at === null ? null : Date.parse(row.rules_accepted_at),
    tier: row.tier,
    createdAtMs: Date.parse(row.created_at),
  };
}

export function createAccountRemote(client: DbClient): AccountRemote {
  return {
    async sendEmailLink(email, redirectTo) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
      fail('send a sign-in link', error);
    },

    async verifyEmailCode(email, code) {
      const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      fail('check the code', error);
    },

    async startOAuth(provider: OAuthProvider, redirectTo) {
      const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo } });
      fail(`sign in with ${provider}`, error);
    },

    async signOut() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      fail('sign out', error);
    },

    async email() {
      const { data } = await client.auth.getSession();
      return data.session?.user.email ?? null;
    },

    async myProfile() {
      const { data, error } = await client.rpc('my_profile');
      fail('read the profile', error);
      // The generated types cannot know rules_accepted_at may be null.
      const row = (data as readonly ProfileRow[] | null)?.[0];
      return row === undefined ? null : toProfile(row);
    },

    async handlesAvailable(handles) {
      if (handles.length === 0) return [];
      const { data, error } = await client.rpc('handles_available', {
        p_handles: handles.slice(0, 10),
      });
      fail('check handles', error);
      return data ?? [];
    },

    async claimHandle(handle, isAdult) {
      const { error } = await client.rpc('claim_handle', {
        p_handle: handle,
        p_is_adult: isAdult,
      });
      fail('claim the handle', error);
    },

    async acceptRules() {
      const { data, error } = await client.rpc('accept_rules');
      fail('agree to the rules', error);
      return Date.parse(data ?? '');
    },

    async deleteAccount() {
      const { error } = await client.rpc('delete_my_account');
      fail('delete the account', error);
    },
  };
}
