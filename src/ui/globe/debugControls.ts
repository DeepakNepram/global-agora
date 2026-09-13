import type { LatLon } from '@/core';
import type { EarthChannel } from '@/globe';

/**
 * Phase 1.1 inspection controls. These exist to verify UV mapping at the places
 * it fails — the antimeridian and the poles — before orbit controls exist.
 * Prompt 1.2's camera rig replaces the presets.
 */

export type ViewPresetId = 'primeMeridian' | 'antimeridian' | 'northPole' | 'southPole';

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
];

export interface ChannelOption {
  readonly id: EarthChannel;
  readonly key: string;
  readonly label: string;
}

export const CHANNEL_OPTIONS: readonly ChannelOption[] = [
  { id: 'day', key: 'd', label: 'Day' },
  { id: 'night', key: 'n', label: 'Night' },
  { id: 'specular', key: 's', label: 'Specular' },
  { id: 'dayNight', key: 'x', label: 'Day + night' },
];

export const CLOUDS_KEY = 'c';

export function viewPreset(id: ViewPresetId): ViewPreset {
  const preset = VIEW_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown view preset: ${id}`);
  return preset;
}
