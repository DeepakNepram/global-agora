import { describe, expect, it } from 'vitest';

import {
  formatLatLon,
  formatUtcClock,
  formatUtcDate,
  minuteOfUtcDay,
  withMinuteOfUtcDay,
  withUtcDate,
} from './timeDebug';

const T = Date.parse('2026-09-13T00:39:30Z');

describe('debug time helpers', () => {
  it('reads the minute of the UTC day', () => {
    expect(minuteOfUtcDay(T)).toBe(39);
    expect(minuteOfUtcDay(Date.parse('2026-09-13T23:59:59Z'))).toBe(1439);
  });

  it('moves within the same UTC day', () => {
    expect(withMinuteOfUtcDay(T, 0)).toBe(Date.parse('2026-09-13T00:00Z'));
    expect(withMinuteOfUtcDay(T, 1439)).toBe(Date.parse('2026-09-13T23:59Z'));
  });

  it('changes date but keeps the clock time', () => {
    expect(withUtcDate(T, '2026-06-21')).toBe(Date.parse('2026-06-21T00:39Z'));
    expect(withUtcDate(T, '')).toBeNull();
  });

  it('formats UTC date, clock and coordinates', () => {
    expect(formatUtcDate(T)).toBe('2026-09-13');
    expect(formatUtcClock(T)).toBe('00:39 UTC');
    expect(formatLatLon({ lat: 3.68, lon: -1.02 })).toBe('3.7°N 1.0°W');
    expect(formatLatLon({ lat: -23.44, lon: 179.99 })).toBe('23.4°S 180.0°E');
  });
});
