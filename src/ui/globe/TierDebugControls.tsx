import { useId, type JSX } from 'react';

import type { QualityTier } from '@/core';

import { readTierOverride, writeTierOverride } from '../platform/capabilities';
import { DEBUG_BUTTON } from './debugControls';

interface TierChoice {
  /** null clears the override and returns to automatic detection. */
  readonly value: QualityTier | null;
  readonly label: string;
}

/**
 * High is left out on purpose: its 8K textures can exhaust a phone's memory,
 * and an override persists across reloads, so a crash would repeat on every
 * load. Desktops that qualify get High from Auto.
 */
const CHOICES: readonly TierChoice[] = [
  { value: null, label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
];

export interface TierDebugControlsProps {
  /** The tier this page load is running. */
  readonly tier: QualityTier;
}

/**
 * Forces a quality tier and reloads, so the same benchmark can run on another
 * tier on a phone, where localStorage cannot be edited by hand.
 */
export function TierDebugControls({ tier }: TierDebugControlsProps): JSX.Element {
  const labelId = useId();
  const override = readTierOverride();

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <p id={labelId} className="text-[11px] uppercase tracking-wide text-muted">
        Quality tier (reloads) · now {tier}
      </p>
      {CHOICES.map((choice) => (
        <button
          key={choice.label}
          type="button"
          className={DEBUG_BUTTON}
          aria-pressed={override === choice.value}
          onClick={() => {
            writeTierOverride(choice.value);
            window.location.reload();
          }}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
