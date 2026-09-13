import type { LatLon } from '@/core';
import type { EarthChannel } from '@/globe';

/**
 * Phase 1.1 inspection controls. These exist to verify UV mapping at the places
 * it fails — the antimeridian and the poles — before orbit controls exist.
 * Prompt 1.2's camera rig replaces the presets.
 */

export type ViewPresetId = 'primeMeridian' | 'antimeridian' | 'northPole' | 'southPole' | 'india';

export interface ViewPreset {
  readonly id: ViewPresetId;
  readonly key: string;
  readonly label: string;
  readonly at: LatLon;
}

export const VIEW_PRESETS: readonly ViewPreset[] = [
  { id: 'primeMeridian', key: '1', label: 'Prime meridian', at: { lat: 0, lon: 0 } },
  { id: 'antimeridian', key: '2', label: 'Antimeridian', at: { lat: 0, lon: 180 } },
  { id: 'northPole', key: '3', label: 'North pole', at: { lat: 90, lon: 0 } },
  { id: 'southPole', key: '4', label: 'South pole', at: { lat: -90, lon: 0 } },
  // Prompt 1.2's check: sunrise sweeps India from ~23:30 to ~01:15 UTC.
  { id: 'india', key: '5', label: 'India', at: { lat: 22, lon: 79 } },
];

export interface ChannelOption {
  readonly id: EarthChannel;
  readonly key: string;
  readonly label: string;
}

export const CHANNEL_OPTIONS: readonly ChannelOption[] = [
  { id: 'lit', key: 'l', label: 'Sunlit' },
  { id: 'day', key: 'd', label: 'Day' },
  { id: 'night', key: 'n', label: 'Night' },
  { id: 'specular', key: 's', label: 'Specular' },
  { id: 'dayNight', key: 'x', label: 'Day + night' },
];

export const CLOUDS_KEY = 'c';
export const ATMOSPHERE_KEY = 'a';
export const BLOOM_KEY = 'b';

/** Single-key shortcuts must not fire while someone is typing into a field. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export const DEBUG_BUTTON =
  'rounded px-2 py-1 text-left text-xs text-ink hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-accent aria-pressed:text-void disabled:cursor-not-allowed disabled:opacity-50';

// Inherits the button's colour at reduced opacity rather than using text-muted,
// which drops to near-invisible on the accent background of a pressed button.
export const DEBUG_KBD = 'mr-2 opacity-70';

export function viewPreset(id: ViewPresetId): ViewPreset {
  const preset = VIEW_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown view preset: ${id}`);
  return preset;
}
