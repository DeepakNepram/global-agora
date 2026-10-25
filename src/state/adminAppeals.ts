import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

// Directly, not through the barrels: only the /admin chunk carries the console.
import { AdminError } from '@/core/admin';
import type { AdminAppeal } from '@/core/appeal';

import type { AdminSession } from './adminSession';

/**
 * The admin console's appeals (Prompt 5.2): suspended accounts' appeals,
 * waiting ones first, each granted or refused with a reply the account reads.
 */

export interface AppealsState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly items: readonly AdminAppeal[];
  /** The appeal a decision is running on; the others wait. */
  readonly deciding: string | null;
  /** What the last decision did, or why it failed: the page announces it. */
  readonly message: string | null;
}

export type AppealsStore = StoreApi<AppealsState>;

export function createAppealsStore(): AppealsStore {
  return createStore<AppealsState>()(() => ({
    status: 'idle',
    items: [],
    deciding: null,
    message: null,
  }));
}

export const appealsStore: AppealsStore = createAppealsStore();

export function useAppealsStore<T>(selector: (state: AppealsState) => T): T {
  return useStore(appealsStore, selector);
}

/** Waiting appeals: the tab's count. */
export function pendingCount(items: readonly AdminAppeal[]): number {
  return items.filter((item) => item.status === 'pending').length;
}

export interface AppealsController {
  load(): Promise<void>;
  /** Grants or refuses; true when it was decided. */
  decide(id: string, grant: boolean, reply: string): Promise<boolean>;
}

/** The list's length: waiting appeals, and the latest decided below them. */
export const APPEALS_PAGE = 50;

export function createAppealsController(options: {
  readonly store: AppealsStore;
  readonly connect: () => Promise<AdminSession>;
}): AppealsController {
  const { store, connect } = options;

  async function load(): Promise<void> {
    if (store.getState().status === 'idle') store.setState({ status: 'loading' });
    try {
      const items = await (await connect()).appeals.list(APPEALS_PAGE);
      store.setState({ status: 'ready', items });
    } catch {
      store.setState({ status: 'failed' });
    }
  }

  return {
    load,

    async decide(id, grant, reply) {
      if (store.getState().deciding !== null) return false;
      store.setState({ deciding: id, message: null });
      try {
        await (await connect()).appeals.decide(id, grant, reply.trim());
        await load();
        const left = pendingCount(store.getState().items);
        store.setState({
          deciding: null,
          message:
            `${grant ? 'Granted: the suspension has ended.' : 'Refused: the suspension stays.'} ` +
            (left === 0 ? 'Nothing else waiting.' : `${left} waiting.`),
        });
        return true;
      } catch (error) {
        const code = error instanceof AdminError ? error.code : 'unknown';
        store.setState({
          deciding: null,
          message:
            code === 'decided'
              ? 'Someone else decided this appeal first.'
              : code === 'invalid'
                ? 'Write a reply, in 500 characters or fewer.'
                : 'The decision could not be saved. Try again.',
        });
        if (code === 'decided') await load();
        return false;
      }
    },
  };
}
