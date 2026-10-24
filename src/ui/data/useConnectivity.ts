import { useEffect } from 'react';

import { connectivityStore } from '@/state';

/** Keeps connectivityStore in step with the browser's online and offline events. */
export function useConnectivity(): void {
  useEffect(() => {
    const update = (): void => connectivityStore.getState().setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
}
