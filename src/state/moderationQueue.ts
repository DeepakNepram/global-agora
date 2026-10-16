import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { ModerationError, type AccountRemote } from '@/core';
import type { DbConfig } from '@/core/db';
// Directly, not through the barrels: only the /admin chunk carries the queue.
import {
  QUEUE_PAGE,
  type AdminRemote,
  type ModerationAction,
  type QueueItem,
} from '@/core/moderationQueue';

/**
 * The /admin moderation queue (Prompt 4.3). The page signs in nowhere: it
 * reads the session the reader made on the globe (the same storage key), and
 * the database decides who is an admin.
 */

export type QueueStatus = 'loading' | 'signed-out' | 'not-admin' | 'ready' | 'unreachable';

export interface QueueState {
  readonly status: QueueStatus;
  readonly handle: string | null;
  readonly items: readonly QueueItem[];
  /** The post an action is running on; the others wait. */
  readonly acting: string | null;
  /** What the last action did, or why it failed: the page announces it. */
  readonly message: string | null;
}

export type QueueStore = StoreApi<QueueState>;

export function createQueueStore(): QueueStore {
  return createStore<QueueState>()(() => ({
    status: 'loading',
    handle: null,
    items: [],
    acting: null,
    message: null,
  }));
}

export const queueStore: QueueStore = createQueueStore();

export function useQueueStore<T>(selector: (state: QueueState) => T): T {
  return useStore(queueStore, selector);
}

export interface AdminSession {
  readonly account: AccountRemote;
  readonly admin: AdminRemote;
  /** Whether a reader is signed in on this device. */
  signedIn(): Promise<boolean>;
}

export async function loadAdminSession(config: DbConfig): Promise<AdminSession> {
  const db = await import('@/core/db');
  const client = db.createDbClient(config);
  return {
    account: db.createAccountRemote(client),
    admin: db.createAdminRemote(client),
    async signedIn() {
      const { data } = await client.auth.getSession();
      return data.session !== null;
    },
  };
}

export interface QueueController {
  /** Who is here, then the queue. */
  start(): Promise<void>;
  refresh(): Promise<void>;
  act(postId: string, action: ModerationAction): Promise<boolean>;
}

const DONE: Readonly<Record<ModerationAction, string>> = {
  approve: 'Approved: it is public.',
  remove: 'Removed.',
  strike: 'Removed, and the author has a strike.',
};

function waiting(count: number): string {
  return count === 0 ? 'Nothing else waiting.' : `${count} waiting.`;
}

export function createQueueController(options: {
  readonly store: QueueStore;
  readonly load: () => Promise<AdminSession>;
}): QueueController {
  const { store, load } = options;
  let session: Promise<AdminSession> | null = null;
  const connect = (): Promise<AdminSession> => (session ??= load());

  async function refresh(): Promise<void> {
    try {
      const items = await (await connect()).admin.queue(QUEUE_PAGE);
      store.setState({ status: 'ready', items });
    } catch (error) {
      const notAdmin = error instanceof ModerationError && error.code === 'not-allowed';
      store.setState({ status: notAdmin ? 'not-admin' : 'unreachable' });
    }
  }

  return {
    async start() {
      store.setState({ status: 'loading' });
      try {
        const loaded = await connect();
        if (!(await loaded.signedIn())) {
          store.setState({ status: 'signed-out' });
          return;
        }
        const profile = await loaded.account.myProfile();
        store.setState({ handle: profile?.handle ?? null });
        if (profile?.isAdmin !== true) {
          store.setState({ status: 'not-admin' });
          return;
        }
      } catch {
        session = null;
        store.setState({ status: 'unreachable' });
        return;
      }
      await refresh();
    },

    refresh,

    async act(postId, action) {
      if (store.getState().acting !== null) return false;
      store.setState({ acting: postId, message: null });
      try {
        await (await connect()).admin.act(postId, action);
        const items = store.getState().items.filter((item) => item.postId !== postId);
        store.setState({
          items,
          acting: null,
          message: `${DONE[action]} ${waiting(items.length)}`,
        });
        return true;
      } catch (error) {
        const code = error instanceof ModerationError ? error.code : 'unknown';
        if (code === 'out-of-order' || code === 'not-found') {
          // Someone else got there first: it is no longer this queue's.
          const items = store.getState().items.filter((item) => item.postId !== postId);
          store.setState({
            items,
            acting: null,
            message: `Already dealt with by someone else. ${waiting(items.length)}`,
          });
        } else {
          store.setState({
            acting: null,
            message:
              code === 'not-allowed'
                ? 'This account cannot moderate any more. Reload to check.'
                : 'That did not go through. Check the connection and try again.',
          });
        }
        return false;
      }
    },
  };
}
