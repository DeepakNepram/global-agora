import { getAccountSession } from '@/state';

import type * as PanelChunk from './DiscussionPanel';

/**
 * The discussion panel's contents are their own chunk, and reading them needs
 * the SDK (guests too). Both load ahead, at idle, once a peek card shows an
 * open discussion, and Discuss waits for them before anything moves: no
 * module is parsed or run in the middle of the transition (Prompt 4.5).
 */

type PanelModule = typeof PanelChunk;

let loading: Promise<PanelModule> | null = null;
let loaded: PanelModule | null = null;

function loadPanel(): Promise<PanelModule> {
  loading ??= import('./DiscussionPanel').then(
    (module) => (loaded = module),
    (error: unknown) => {
      // A chunk that failed to arrive is tried again next time.
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The panel's module once it has arrived, so the panel renders without suspending. */
export function loadedDiscussionPanel(): PanelModule | null {
  return loaded;
}

/** Loads the panel and the SDK session. Rejects if either cannot be loaded. */
export async function loadDiscussion(): Promise<void> {
  await Promise.all([loadPanel(), getAccountSession()]);
}

/** loadDiscussion when the browser is idle; failures wait for Discuss to try again. */
export function preloadDiscussion(): void {
  const start = (): void => void loadDiscussion().catch(() => undefined);
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 2000 });
  } else {
    window.setTimeout(start, 200);
  }
}
