import { useMemo, type JSX } from 'react';

import type { NodeBuffer } from '@/core';
import { useNodesStore } from '@/state';

/** Epoch ms of the newest story; nodes arrive in time order, but take the max anyway. */
function newestMs(nodes: NodeBuffer): number | null {
  if (nodes.count === 0) return null;
  let newest = 0;
  for (let i = 0; i < nodes.count; i++) newest = Math.max(newest, nodes.publishedSec[i] ?? 0);
  return (nodes.epochSec + newest) * 1000;
}

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
  const newest = useMemo(() => (nodes === null ? null : newestMs(nodes)), [nodes]);

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
