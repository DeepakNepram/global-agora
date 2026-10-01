import { minutesAgo } from '@/core';

/**
 * The scrubber's readout: the displayed instant in UTC and in the viewer's
 * own time zone, and how long ago it was. The zone comes from the browser
 * (Intl), never from a location, and nothing here leaves the device.
 */

export interface TimeLabel {
  /** "14:32 UTC". */
  readonly utc: string;
  /** "20:02 GMT+5:30", with the weekday when it is not the viewer's today: "Tue 20:02 EDT". */
  readonly local: string;
  /** "Live", "Just now", "28 min ago", "3 h 28 min ago". */
  readonly relative: string;
  /** All of it in words, for the slider's aria-valuetext. */
  readonly spoken: string;
}

export interface TimeLabelZone {
  /** IANA zone; the browser's own when omitted. */
  readonly timeZone?: string;
  /** BCP 47 locale; the browser's own when omitted. */
  readonly locale?: string;
}

function utcClock(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(11, 16);
}

function localDay(timeMs: number, zone: TimeLabelZone): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(timeMs);
}

function localClock(timeMs: number, nowMs: number, zone: TimeLabelZone): string {
  const otherDay = localDay(timeMs, zone) !== localDay(nowMs, zone);
  return new Intl.DateTimeFormat(zone.locale, {
    timeZone: zone.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(otherDay ? { weekday: 'short' } : {}),
  }).format(timeMs);
}

function relativeText(minutes: number): { short: string; spoken: string } {
  if (minutes < 1) return { short: 'Just now', spoken: 'just now' };
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (hours === 0) return { short: `${rest} min ago`, spoken: `${plural(rest, 'minute')} ago` };
  if (rest === 0) return { short: `${hours} h ago`, spoken: `${plural(hours, 'hour')} ago` };
  return {
    short: `${hours} h ${rest} min ago`,
    spoken: `${plural(hours, 'hour')} ${plural(rest, 'minute')} ago`,
  };
}

export function formatTimeLabel(
  timeMs: number,
  nowMs: number,
  isLive: boolean,
  zone: TimeLabelZone = {},
): TimeLabel {
  const utc = `${utcClock(timeMs)} UTC`;
  const local = localClock(timeMs, nowMs, zone);
  const ago = relativeText(minutesAgo(timeMs, nowMs));
  const relative = isLive ? 'Live' : ago.short;
  const spoken = `${isLive ? 'Live' : ago.spoken}, ${utc}, ${local} local time`;
  return { utc, local, relative, spoken };
}
