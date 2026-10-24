import { useMemo, type JSX } from 'react';

import { newestStoryMs } from '@/core';
import { useNodesStore } from '@/state';

const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * One polite live region for the news feed, so a screen reader hears when the
 * stories arrive or fail. "Newest" is the newest story's publish time: GDELT
 * publishes about an hour behind, and saying so beats implying live.
 */
export function NewsStatus(): JSX.Element {
  const nodes = useNodesStore((state) => state.nodes);
  const status = useNodesStore((state) => state.status);
  const failures = useNodesStore((state) => state.failures);
  const newest = useMemo(() => (nodes === null ? null : newestStoryMs(nodes)), [nodes]);

  let text = 'Loading news…';
  if (status === 'error') text = 'News is unavailable. Retrying.';
  else if (nodes !== null) {
    const count = `${nodes.count.toLocaleString()} ${nodes.count === 1 ? 'story' : 'stories'}`;
    const latest = newest === null ? '' : ` · newest ${TIME.format(new Date(newest))}`;
    text = `${count}${latest}${failures > 0 ? ' · reconnecting' : ''}`;
  }

  return (
    <p role="status" aria-live="polite" data-testid="news-status" className="text-sm text-muted">
      {text}
    </p>
  );
}
