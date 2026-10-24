import { useEffect } from 'react';

import { retryDelayMs, startNodesFeed, type NodesFeed } from '@/core';
import { nodesStore, wallClockNow } from '@/state';

export interface NodesFeedConfig {
  /** AppConfig.apiBaseUrl. */
  readonly baseUrl: string;
  /** AppConfig.historyWindowHours: the payload covers the scrubber's whole reach. */
  readonly hours: number;
  /** AppConfig.payloadRefreshSeconds. */
  readonly refreshSeconds: number;
}

let activeFeed: NodesFeed | null = null;

/** "Try now" after a failed load (Prompt 5.2): checks at once instead of waiting out the backoff. */
export function retryNewsNow(): void {
  activeFeed?.resume();
}

/**
 * Runs the payload feed for the app's lifetime and writes what it gets into
 * nodesStore. Checks pause while the tab is hidden and resume, with an
 * immediate check, when it is shown again or the device comes back online.
 */
export function useNodesFeed({ baseUrl, hours, refreshSeconds }: NodesFeedConfig): void {
  useEffect(() => {
    const feed = startNodesFeed({
      baseUrl,
      hours,
      refreshMs: refreshSeconds * 1000,
      fetch: (input, init) => fetch(input, init),
      timers: {
        set: (callback, ms) => window.setTimeout(callback, ms),
        clear: (handle) => window.clearTimeout(handle as number),
      },
      onUpdate: (nodes, etag, savedAtMs) => nodesStore.getState().loaded(nodes, etag, savedAtMs),
      onUnchanged: (etag, savedAtMs) => nodesStore.getState().unchanged(etag, savedAtMs),
      onError: (error, failures) => {
        const retryAtMs = wallClockNow() + retryDelayMs(failures, refreshSeconds * 1000);
        nodesStore.getState().failed(failures, retryAtMs);
        console.warn('News payload check failed; retrying.', error);
      },
    });

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') feed.resume();
      else feed.pause();
    };
    // Back online: check at once rather than wait out the backoff.
    const onOnline = (): void => {
      if (document.visibilityState === 'visible') feed.resume();
    };
    activeFeed = feed;
    if (document.visibilityState !== 'visible') feed.pause();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      if (activeFeed === feed) activeFeed = null;
      feed.stop();
    };
  }, [baseUrl, hours, refreshSeconds]);
}
