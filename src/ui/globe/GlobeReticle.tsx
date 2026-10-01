import type { JSX } from 'react';

import { ACTIVATE_RADIUS_CSS_PX } from '@/globe';

export interface GlobeReticleProps {
  /** What the last Enter did, read out politely. */
  readonly message: string;
}

/**
 * The keyboard's aim: while the globe has keyboard focus, a ring at the centre
 * of the view shows what Enter will open. It must follow the canvas wrapper
 * (the Tailwind `peer`) in the DOM, so CSS alone can show it on focus-visible.
 */
export function GlobeReticle({ message }: GlobeReticleProps): JSX.Element {
  const size = ACTIVATE_RADIUS_CSS_PX * 2;
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-ink/60 peer-focus-visible:block"
        style={{ width: size, height: size }}
      >
        <p className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded bg-void/80 px-2 py-0.5 text-xs text-ink">
          Enter: open story
        </p>
      </div>
      <p role="status" className="sr-only">
        {message}
      </p>
    </>
  );
}
