import { useEffect } from 'react';

/** Long enough for the globe's first frames and the payload to come first. */
const IDLE_TIMEOUT_MS = 4000;

/**
 * Fetches a lazy chunk once the browser is idle after start, so opening it
 * later is instant without its bytes counting against the cold start.
 */
export function useIdlePreload(load: () => Promise<unknown>): void {
  useEffect(() => {
    const run = (): void => {
      void load().catch(() => {
        // A failed preload is retried by the real import when it is needed.
      });
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(run, IDLE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [load]);
}
