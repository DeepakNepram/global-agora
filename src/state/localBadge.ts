import { createStore, type StoreApi } from 'zustand/vanilla';

import type { LocalBadgeReply } from '@/core/localBadge';

/**
 * Whether a post sent now could carry the local badge (Prompt 4.4), and what
 * it would say. Checked each time a composer opens: the answer belongs to the
 * network the reader is on, which can change between posts. Not in the state
 * barrel; Prompt 4.5's composer imports it.
 */
export type LocalBadgeStatus =
  | { readonly kind: 'checking' }
  | { readonly kind: 'available'; readonly label: string }
  /** Cloudflare places this network in no city. */
  | { readonly kind: 'no-city' }
  /** The Worker cannot attach labels (not configured). */
  | { readonly kind: 'unavailable' }
  /** The Worker could not be asked. */
  | { readonly kind: 'failed' };

export type LocalBadgeStore = StoreApi<LocalBadgeStatus>;

export function createLocalBadgeStore(): LocalBadgeStore {
  return createStore<LocalBadgeStatus>()(() => ({ kind: 'checking' }));
}

export function badgeStatusFrom(reply: LocalBadgeReply): LocalBadgeStatus {
  if (reply.label !== null) return { kind: 'available', label: reply.label };
  return { kind: reply.reason };
}

export interface LocalBadgeController {
  /** Asks again; an answer to an earlier check that arrives late is dropped. */
  check(): Promise<void>;
}

export function createLocalBadgeController(deps: {
  readonly store: LocalBadgeStore;
  readonly fetchBadge: () => Promise<LocalBadgeReply>;
}): LocalBadgeController {
  let latest = 0;
  return {
    async check(): Promise<void> {
      const mine = ++latest;
      deps.store.setState({ kind: 'checking' }, true);
      let status: LocalBadgeStatus;
      try {
        status = badgeStatusFrom(await deps.fetchBadge());
      } catch {
        status = { kind: 'failed' };
      }
      if (mine === latest) deps.store.setState(status, true);
    },
  };
}
