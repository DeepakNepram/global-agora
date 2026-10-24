import type { JSX } from 'react';

import { useNodesStore } from '@/state';

import type { NewsProblemKind } from './data/useNewsProblem';
import { retryNewsNow } from './data/useNodesFeed';
import { useWallClock } from './platform/useWallClock';

const TRY_NOW =
  'mt-1 h-10 rounded-full border border-ink/20 px-4 text-sm font-medium text-ink hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function RetryCountdown(): JSX.Element {
  const retryAtMs = useNodesStore((state) => state.retryAtMs);
  const nowMs = useWallClock(1000);
  const seconds = retryAtMs === null ? 0 : Math.ceil((retryAtMs - nowMs) / 1000);
  return <>{seconds > 0 ? `Trying again in ${seconds} s.` : 'Trying again…'}</>;
}

/** The words and the one action for a NewsProblemKind, in the list or over the globe and map. */
export function NewsProblem({ kind }: { readonly kind: NewsProblemKind }): JSX.Element {
  if (kind === 'empty') {
    return (
      <p className="text-sm text-ink">No stories yet. New ones usually arrive every 15 minutes.</p>
    );
  }
  if (kind === 'offline') {
    return (
      <p className="text-sm text-ink">
        No news is saved on this device yet. It will load when you’re back online.
      </p>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-sm text-ink">
        The news can’t load right now. <RetryCountdown />
      </p>
      <button type="button" className={TRY_NOW} onClick={retryNewsNow}>
        Try now
      </button>
    </div>
  );
}
