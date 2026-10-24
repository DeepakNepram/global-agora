import { useMemo, type JSX } from 'react';

import { newestStoryMs, newsAgeText } from '@/core';
import { useConnectivityStore, useNodesStore } from '@/state';

import { useWallClock } from './platform/useWallClock';

function OfflineIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0 fill-none stroke-current"
    >
      <path
        d="M4.5 12.5h7a3 3 0 0 0 .4-5.97A4 4 0 0 0 4.3 6.3 3.1 3.1 0 0 0 4.5 12.5Z"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M2.5 2.5l11 11" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Says when the news on screen is not live (Prompt 5.2): the device is
 * offline, or the news came from the copy the service worker saved because
 * the server could not be reached. The age is the newest story's, so
 * "Showing news from 3 hours ago" is exactly how old the news is.
 */
export function OfflineBanner(): JSX.Element {
  const online = useConnectivityStore((state) => state.online);
  const savedAtMs = useNodesStore((state) => state.savedAtMs);
  const nodes = useNodesStore((state) => state.nodes);
  const newest = useMemo(() => (nodes === null ? null : newestStoryMs(nodes)), [nodes]);
  const nowMs = useWallClock(60_000);

  let text: string | null = null;
  if (!online || savedAtMs !== null) {
    const where = online ? 'Global Agora can’t be reached right now.' : 'You’re offline.';
    text =
      newest === null
        ? `${where} The news will load when the connection is back.`
        : `${where} Showing news from ${newsAgeText(newest, nowMs)}.`;
  }

  return (
    <div role="status" data-testid="offline-banner">
      {text !== null && (
        <p className="flex items-center gap-2 border-y border-edge bg-panel px-6 py-2 text-sm text-ink">
          <OfflineIcon />
          {text}
        </p>
      )}
    </div>
  );
}
