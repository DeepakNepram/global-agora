import { useEffect, useRef } from 'react';

import { onboardingStore, ONBOARDING_AFTER_SECONDS } from '@/state';

/**
 * Shows the onboarding after ONBOARDING_AFTER_SECONDS of visible use
 * (counted across visits), but never over another sheet: it waits until the
 * reader is back on the globe. The first save shows it too (StoryLayer).
 */
export function useOnboardingTrigger(busy: boolean): void {
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (onboardingStore.getState().status !== 'pending') return;
    const timer = window.setInterval(() => {
      const store = onboardingStore.getState();
      if (store.status !== 'pending') {
        window.clearInterval(timer);
        return;
      }
      if (document.visibilityState === 'visible') store.addUse(1);
      if (store.usedSeconds + 1 >= ONBOARDING_AFTER_SECONDS && !busyRef.current) store.show();
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
}
