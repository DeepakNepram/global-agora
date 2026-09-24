import type { CameraPose, EarthChannel } from '@/globe';

/**
 * Dev-only inspection controls: the texture channels from 1.1, and since 1.4
 * the fly-to cities that exercise the camera.
 */

/** Low enough to feel like arriving somewhere; the imagery is still legible. */
const CITY_ALTITUDE_KM = 600;

export interface CityFlight {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly pose: CameraPose;
}

/**
 * Picked for the routes between them, not the cities: Paris-London is a short
 * hop with no climb, London-New York a medium arc, New York-Delhi runs close to
 * the pitch clamp over the Arctic, and London-Sydney is nearly antipodal (the
 * 3 s end of the duration curve). Delhi keeps 1.2's sunrise check reachable.
 */
export const CITY_FLIGHTS: readonly CityFlight[] = [
  {
    id: 'london',
    key: '1',
    label: 'London',
    pose: { lat: 51.5074, lon: -0.1278, altitudeKm: CITY_ALTITUDE_KM },
  },
  {
    id: 'paris',
    key: '2',
    label: 'Paris',
    pose: { lat: 48.8566, lon: 2.3522, altitudeKm: CITY_ALTITUDE_KM },
  },
  {
    id: 'newYork',
    key: '3',
    label: 'New York',
    pose: { lat: 40.7128, lon: -74.006, altitudeKm: CITY_ALTITUDE_KM },
  },
  {
    id: 'delhi',
    key: '4',
    label: 'Delhi',
    pose: { lat: 28.6139, lon: 77.209, altitudeKm: CITY_ALTITUDE_KM },
  },
  {
    id: 'sydney',
    key: '5',
    label: 'Sydney',
    pose: { lat: -33.8688, lon: 151.2093, altitudeKm: CITY_ALTITUDE_KM },
  },
];

export const WORLD_VIEW_KEY = '0';
export const FULL_MOTION_KEY = 'm';

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
export const PINS_KEY = 'p';

/** Prompt 1.5's acceptance load, and a stress load to show the headroom above it. */
export const PIN_COUNTS = [3000, 10_000] as const;
export type PinCount = (typeof PIN_COUNTS)[number];

/** What the pins show: the live payload, or a seeded mock load of that many stories. */
export type PinSource = 'live' | PinCount;

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
