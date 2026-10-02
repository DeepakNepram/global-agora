import { useEffect } from 'react';

import type { DbConfig } from '@/core/db/config';
import { resumeAccountSession } from '@/state';

/**
 * Resumes a signed-in session on start: the SDK loads and the library moves
 * to the account (src/state/library.ts). A guest, or a build without a
 * backend, loads nothing.
 */
export function useAccountSession(config: DbConfig | null): void {
  useEffect(() => {
    let dispose: (() => void) | null = null;
    let cancelled = false;
    resumeAccountSession(config).then(
      (session) => {
        if (cancelled) session?.dispose();
        else dispose = session?.dispose ?? null;
      },
      () => {
        // The SDK chunk failed to load: the library stays on the device.
      },
    );
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [config]);
}
