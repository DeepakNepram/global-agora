import { useEffect } from 'react';

import { LIVE_SYNC_INTERVAL_MS, timeStore } from '@/state';

/**
 * Keeps the time store on the wall clock while it is in live mode.
 *
 * Syncs every LIVE_SYNC_INTERVAL_MS and immediately when the tab becomes
 * visible, so a page left in the background shows the right day/night on
 * return. Nothing runs while hidden. Each sync that changes the time costs one
 * rendered frame; while scrubbed, syncLive is a no-op and nothing renders.
 *
 * Deliberately not paused by prefers-reduced-motion: a 0.125° step every 30s is
 * not motion anyone can see, and the lighting should still tell the truth.
 */
export function useLiveClock(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = (): void => timeStore.getState().syncLive();

    const stop = (): void => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = (): void => {
      if (timer !== undefined) return;
      sync();
      timer = setInterval(sync, LIVE_SYNC_INTERVAL_MS);
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stop();
    };
  }, []);
}
