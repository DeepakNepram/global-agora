import type { JSX } from 'react';

import { useGlobeHealth } from '@/state';

import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Says why the flat map is showing when the reader would expect the globe
 * (Prompt 5.2). Under reduced motion the map is the choice, so it says
 * nothing.
 */
export function GlobeNotice({ webgl }: { readonly webgl: boolean }): JSX.Element {
  const fallback = useGlobeHealth((state) => state.fallback);
  const reduced = usePrefersReducedMotion();
  let text: string | null = null;
  if (!reduced) {
    if (!webgl) text = 'This browser can’t draw the 3D globe, so the news is on a flat map.';
    else if (fallback === 'lost') {
      text =
        'The 3D globe kept losing its graphics, so this is the flat map. Reload to try the globe again.';
    } else if (fallback === 'crashed') {
      text =
        'The 3D globe stopped working, so this is the flat map. Reload to try the globe again.';
    }
  }
  return (
    <div role="status" data-testid="globe-notice">
      {text !== null && (
        <p className="border-b border-edge bg-panel px-6 py-2 text-sm text-ink">{text}</p>
      )}
    </div>
  );
}
