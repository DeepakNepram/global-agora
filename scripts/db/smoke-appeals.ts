/**
 * db:smoke's appeals checks (Prompt 5.2), on the LOCAL stack: a suspended
 * reader appeals through the account remote, a moderator grants it through
 * the appeals remote, as the account sheet and /admin do; the reader's
 * suspension ends and the reply reaches their updates.
 *
 * What it changes it puts back: the throwaway users go (their appeals and
 * notices with them), and the admin log loses the row it wrote.
 */
import { AccountError } from '../../src/core/account.ts';
import { AdminError } from '../../src/core/admin.ts';
import { createAccountRemote } from '../../src/core/db/account.ts';
import { createAppealsRemote } from '../../src/core/db/appeals.ts';
import type { DbConfig } from '../../src/core/db/client.ts';

import { service } from './smoke-discussion.ts';
import { admin, type Record, type TestUser } from './smoke-library.ts';
import { participant } from './smoke-moderation.ts';

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'none';
  } catch (error) {
    return error instanceof AccountError || error instanceof AdminError
      ? error.code
      : String(error);
  }
}

export async function appealChecks(
  config: DbConfig,
  serviceKey: string,
  record: Record,
): Promise<void> {
  const users: TestUser[] = [];
  let moderatorId: string | null = null;
  try {
    const moderator = await participant(config, serviceKey, 'appeal-mod', users);
    moderatorId = moderator.id;
    await service(config, serviceKey, 'admins', {
      method: 'POST',
      body: JSON.stringify({ user_id: moderator.id }),
    });
    const reader = await participant(config, serviceKey, 'appealer', users);
    const account = createAccountRemote(reader.client);

    // --- Only a suspended account appeals, once at a time. ---------------------
    const tooEarly = await codeOf(() => account.submitAppeal('Nothing to appeal.'));
    await service(config, serviceKey, `profiles?id=eq.${reader.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ suspended_at: new Date().toISOString() }),
    });
    const sent = await codeOf(() => account.submitAppeal('Smoke: the post quoted the article.'));
    const twice = await codeOf(() => account.submitAppeal('And again.'));
    const waiting = (await account.myProfile())?.appeal?.status;
    record(
      'a suspended reader appeals, once at a time',
      tooEarly === 'appeal-not-now' &&
        sent === 'none' &&
        twice === 'appeal-waiting' &&
        waiting === 'pending',
      `before suspension ${tooEarly}; sent ${sent}; again ${twice}; profile ${waiting ?? '?'}`,
    );

    // --- A moderator grants it. ------------------------------------------------
    const refused = await codeOf(() => createAppealsRemote(reader.client).list(10));
    const appeals = createAppealsRemote(moderator.client);
    const listed = (await appeals.list(50)).find((item) => item.handle.startsWith('sm_appealer'));
    const decided = listed
      ? await appeals.decide(listed.id, true, 'Smoke: granted, it was a quotation.')
      : 'not listed';
    record(
      'a moderator sees the appeal and grants it; a reader cannot',
      refused === 'not-admin' && listed?.status === 'pending' && decided === 'granted',
      `reader ${refused}; listed ${listed?.status ?? 'no'}; ${decided}`,
    );

    // --- The reader is back, and told. ------------------------------------------
    const after = await account.myProfile();
    const { data: notices } = await reader.client
      .from('notifications')
      .select('kind, detail')
      .eq('kind', 'appeal_outcome');
    const told = (notices ?? []).some(
      (notice) => (notice.detail as { granted?: boolean } | null)?.granted === true,
    );
    record(
      'granted: the suspension ends and the reply reaches the reader',
      after?.suspendedAtMs === null && after.appeal?.status === 'granted' && told,
      `suspended ${after?.suspendedAtMs === null ? 'no' : 'yes'}; appeal ${after?.appeal?.status ?? '?'}; notice ${told ? 'yes' : 'no'}`,
    );
  } finally {
    if (moderatorId !== null) {
      await service(config, serviceKey, `admin_actions?actor_id=eq.${moderatorId}`, {
        method: 'DELETE',
      });
    }
    for (const user of users) {
      await admin(config, serviceKey, `users/${user.id}`, { method: 'DELETE' });
    }
  }
}
