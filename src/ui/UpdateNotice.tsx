import type { JSX } from 'react';

import { applyUpdate, useUpdateReady } from './platform/serviceWorker';

const RELOAD =
  'h-8 rounded-full border border-accent px-3 text-sm font-medium text-accent hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * "A new version is ready · Reload", in the header once a new build has
 * installed (Prompt 5.2). Nothing switches until the reader asks. The live
 * region is always there, so the line is announced when it appears.
 */
export function UpdateNotice(): JSX.Element {
  const ready = useUpdateReady();
  return (
    <div role="status" className="contents">
      {ready && (
        <p className="flex items-center gap-2 text-sm text-ink">
          A new version is ready.
          <button type="button" className={RELOAD} onClick={applyUpdate}>
            Reload
          </button>
        </p>
      )}
    </div>
  );
}
