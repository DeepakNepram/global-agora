/**
 * db:smoke's account checks (Prompt 4.1), on the LOCAL stack: a throwaway
 * user goes through the first sign-in's setup (handle, rules) and then
 * deletes the account, which must take everything with it. The user is made
 * through the local admin API; its password is random and never printed.
 */
import { randomUUID } from 'node:crypto';

import { AccountError } from '../../src/core/account.ts';
import { createDbClient, type DbConfig } from '../../src/core/db/client.ts';
import { createAccountRemote } from '../../src/core/db/account.ts';
import { createLibraryRemote } from '../../src/core/db/library.ts';

import { admin, createUser, signedIn, type Record } from './smoke-library.ts';

export async function accountChecks(
  config: DbConfig,
  serviceKey: string,
  record: Record,
): Promise<void> {
  const user = await createUser(config, serviceKey, 'account');
  let deleted = false;
  try {
    const client = await signedIn(config, user);
    const account = createAccountRemote(client);
    const anon = createDbClient(config, { persistSession: false });
    const handle = `smoke_${randomUUID().slice(0, 8).replace(/-/g, '')}`;

    record('a new account has no profile', (await account.myProfile()) === null, 'none');

    const free = await account.handlesAvailable([handle, 'admin', 'Not Valid']);
    record('handles_available keeps only claimable ones', free.join() === handle, free.join());

    await account.claimHandle(handle, true);
    const claimed = await account.myProfile();
    record(
      'claiming a handle makes the profile',
      claimed?.handle === handle && claimed.isAdult && claimed.rulesAcceptedAtMs === null,
      claimed?.handle ?? 'NO PROFILE',
    );

    const seen = await anon.from('profiles').select('handle').eq('handle', handle);
    record('anyone can read the handle', seen.data?.length === 1, seen.error?.message ?? 'read');

    const agreedAt = await account.acceptRules();
    record(
      '"I agree" records the time',
      Math.abs(agreedAt - Date.now()) < 60_000,
      new Date(agreedAt).toISOString(),
    );

    let locked = 'CHANGED';
    try {
      await account.claimHandle(`${handle}_x`, true);
    } catch (error) {
      locked = error instanceof AccountError ? error.code : String(error);
    }
    record('the handle stays once the rules are agreed', locked === 'out-of-order', locked);

    await createLibraryRemote(client).addFollows([
      {
        kind: 'category',
        target: 'climate',
        label: 'Climate',
        baseline: null,
        createdAtMs: Date.now(),
      },
    ]);
    await account.deleteAccount();
    deleted = true;

    const lookup = await admin(config, serviceKey, `users/${user.id}`, { method: 'GET' });
    const after = await anon.from('profiles').select('handle').eq('handle', handle);
    record(
      'deleting the account removes the user and the profile',
      lookup.status === 404 && after.data?.length === 0,
      `user HTTP ${lookup.status}, ${after.data?.length ?? '?'} profiles`,
    );
  } catch (error) {
    record('account checks ran', false, error instanceof Error ? error.message : String(error));
  } finally {
    if (!deleted) await admin(config, serviceKey, `users/${user.id}`, { method: 'DELETE' });
  }
}
