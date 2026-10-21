import { useEffect, useId, useState, type JSX } from 'react';

import type { BlockedAccount } from '@/core';
import { getAccountSession } from '@/state';

import { BODY, SECONDARY } from './accountStyles';

type Load =
  | { readonly status: 'closed' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly accounts: readonly BlockedAccount[] }
  | { readonly status: 'failed' };

const UNBLOCK =
  'h-11 shrink-0 rounded-full border border-ink/20 px-4 text-sm text-ink hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/**
 * The accounts the reader has blocked, with Unblock (Prompt 4.3's blocks,
 * listed by 4.5). Read when opened, from the same session as everything
 * else. A block hides both ways; unblocking lets both see each other again.
 */
export function BlockedList(): JSX.Element {
  const [load, setLoad] = useState<Load>({ status: 'closed' });
  const [message, setMessage] = useState('');
  const listId = useId();
  const open = load.status !== 'closed';

  useEffect(() => {
    if (load.status !== 'loading') return;
    let cancelled = false;
    const session = getAccountSession();
    if (!session) {
      setLoad({ status: 'failed' });
      return;
    }
    session
      .then((s) => s.moderation.blockedAccounts())
      .then(
        (accounts) => {
          if (!cancelled) setLoad({ status: 'ready', accounts });
        },
        () => {
          if (!cancelled) setLoad({ status: 'failed' });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [load.status]);

  const unblock = async (account: BlockedAccount): Promise<void> => {
    const who = account.handle ? `@${account.handle}` : 'That account';
    try {
      const session = await getAccountSession();
      await session?.moderation.unblock(account.userId);
      setLoad((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              accounts: current.accounts.filter((a) => a.userId !== account.userId),
            }
          : current,
      );
      setMessage(`Unblocked ${who}.`);
    } catch {
      setMessage(`${who} could not be unblocked. Try again.`);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={`${SECONDARY} self-start`}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setLoad(open ? { status: 'closed' } : { status: 'loading' })}
      >
        Blocked accounts
      </button>
      <div id={listId} hidden={!open} className="flex flex-col gap-2">
        {load.status === 'loading' && <p className={BODY}>Loading…</p>}
        {load.status === 'failed' && <p className={BODY}>Your blocks could not be read.</p>}
        {load.status === 'ready' &&
          (load.accounts.length === 0 ? (
            <p className={BODY}>You have not blocked anyone.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {load.accounts.map((account) => (
                <li key={account.userId} className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm text-ink">
                    {account.handle ? `@${account.handle}` : 'An account'}
                  </span>
                  <button type="button" className={UNBLOCK} onClick={() => void unblock(account)}>
                    Unblock
                    <span className="sr-only"> {account.handle ? `@${account.handle}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </div>
      <p role="status" className="sr-only">
        {message}
      </p>
    </div>
  );
}
