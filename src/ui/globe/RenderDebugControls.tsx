import { useEffect, useId, type JSX } from 'react';

import type { AtmosphereMode } from '@/globe';

import {
  ATMOSPHERE_KEY,
  BLOOM_KEY,
  DEBUG_BUTTON,
  DEBUG_KBD,
  isTypingTarget,
} from './debugControls';

export interface RenderDebugControlsProps {
  readonly atmosphere: AtmosphereMode;
  readonly onAtmosphereChange: (mode: AtmosphereMode) => void;
  readonly bloomEnabled: boolean;
  readonly onBloomEnabledChange: (enabled: boolean) => void;
  /** False on LOW, which has no composer to bloom with. */
  readonly bloomAvailable: boolean;
}

/**
 * Overrides the tier's atmosphere and bloom so their costs can be measured one
 * at a time. The tier's own choice is what ships; these are for A/B only.
 */
export function RenderDebugControls(props: RenderDebugControlsProps): JSX.Element {
  const { atmosphere, onAtmosphereChange, bloomEnabled, onBloomEnabledChange, bloomAvailable } =
    props;
  const labelId = useId();
  const nextAtmosphere: AtmosphereMode = atmosphere === 'rim' ? 'scattering' : 'rim';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === ATMOSPHERE_KEY) onAtmosphereChange(nextAtmosphere);
      if (key === BLOOM_KEY && bloomAvailable) onBloomEnabledChange(!bloomEnabled);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [nextAtmosphere, onAtmosphereChange, bloomEnabled, onBloomEnabledChange, bloomAvailable]);

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <p id={labelId} className="text-[11px] uppercase tracking-wide text-muted">
        Render
      </p>
      <button
        type="button"
        className={DEBUG_BUTTON}
        aria-pressed={atmosphere === 'scattering'}
        aria-keyshortcuts={ATMOSPHERE_KEY.toUpperCase()}
        onClick={() => onAtmosphereChange(nextAtmosphere)}
      >
        <kbd className={DEBUG_KBD}>{ATMOSPHERE_KEY.toUpperCase()}</kbd>
        Scattering atmosphere
      </button>
      <button
        type="button"
        className={DEBUG_BUTTON}
        aria-pressed={bloomAvailable && bloomEnabled}
        aria-keyshortcuts={BLOOM_KEY.toUpperCase()}
        disabled={!bloomAvailable}
        title={bloomAvailable ? undefined : 'LOW tier renders without postprocessing'}
        onClick={() => onBloomEnabledChange(!bloomEnabled)}
      >
        <kbd className={DEBUG_KBD}>{BLOOM_KEY.toUpperCase()}</kbd>
        Bloom{bloomAvailable ? '' : ' (off on LOW)'}
      </button>
    </div>
  );
}
