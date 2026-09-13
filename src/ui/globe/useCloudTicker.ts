import { useEffect } from 'react';

/**
 * Idle frame rate while clouds drift. At one revolution per 10 minutes a frame
 * moves the clouds ~0.05°, which is sub-pixel, so 12fps looks continuous and
 * costs a fifth of a 60fps loop. See docs/DECISIONS.md.
 */
export const CLOUD_TICK_HZ = 12;

/**
 * Requests frames at CLOUD_TICK_HZ while `enabled` and the tab is visible.
 *
 * Render-on-demand means nothing draws unless asked. Clouds are the one thing
 * that moves with nobody touching the globe, so they ask — slowly, and never
 * from a hidden tab. Callers pass enabled = false under reduced motion.
 */
export function useCloudTicker(invalidate: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;

    const sync = (): void => {
      const visible = document.visibilityState === 'visible';
      if (visible && timer === undefined) {
        timer = window.setInterval(invalidate, 1000 / CLOUD_TICK_HZ);
      } else if (!visible && timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };

    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [invalidate, enabled]);
}
