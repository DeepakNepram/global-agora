import { useEffect } from 'react';

import { startNodesFeed } from '@/core';
import { nodesStore } from '@/state';

export interface NodesFeedConfig {
  /** AppConfig.apiBaseUrl. */
  readonly baseUrl: string;
  /** AppConfig.historyWindowHours: the payload covers the scrubber's whole reach. */
  readonly hours: number;
  /** AppConfig.payloadRefreshSeconds. */
  readonly refreshSeconds: number;
}

/**
 * Runs the payload feed for the app's lifetime and writes what it gets into
 * nodesStore. Checks pause while the tab is hidden and resume, with an
 * immediate check, when it is shown again.
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
      onUpdate: (nodes, etag) => nodesStore.getState().loaded(nodes, etag),
      onUnchanged: (etag) => nodesStore.getState().unchanged(etag),
      onError: (error, failures) => {
        nodesStore.getState().failed(failures);
        console.warn('News payload check failed; retrying.', error);
      },
    });

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') feed.resume();
      else feed.pause();
    };
    if (document.visibilityState !== 'visible') feed.pause();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      feed.stop();
    };
  }, [baseUrl, hours, refreshSeconds]);
}
