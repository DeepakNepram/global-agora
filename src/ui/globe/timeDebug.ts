import { normalizeLon, type LatLon } from '@/core';

/**
 * Pure helpers for the debug time slider. The slider works in minutes of one
 * UTC day, because the check it exists for ("does sunrise reach India at the
 * right UTC hour?") is phrased in UTC clock time.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export const MINUTES_PER_DAY = 1440;

export function utcDayStart(timeMs: number): number {
  return Math.floor(timeMs / MS_PER_DAY) * MS_PER_DAY;
}

export function minuteOfUtcDay(timeMs: number): number {
  return Math.floor((timeMs - utcDayStart(timeMs)) / MS_PER_MINUTE);
}

/** Keeps the minute of day when moving to another date. */
export function withUtcDate(timeMs: number, isoDate: string): number | null {
  const dayStart = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(dayStart)) return null;
  return dayStart + minuteOfUtcDay(timeMs) * MS_PER_MINUTE;
}

export function withMinuteOfUtcDay(timeMs: number, minute: number): number {
  return utcDayStart(timeMs) + minute * MS_PER_MINUTE;
}

export function formatUtcDate(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(0, 10);
}

export function formatUtcClock(timeMs: number): string {
  return `${new Date(timeMs).toISOString().slice(11, 16)} UTC`;
}

export function formatLatLon(at: LatLon): string {
  const lat = `${Math.abs(at.lat).toFixed(1)}°${at.lat >= 0 ? 'N' : 'S'}`;
  const lon = normalizeLon(at.lon);
  return `${lat} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
}
