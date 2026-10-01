import { describe, expect, it } from 'vitest';

import { formatTimeLabel } from './timeLabel';

const NOW = Date.UTC(2026, 9, 1, 14, 32, 0);
const MINUTE = 60_000;
const KOLKATA = { timeZone: 'Asia/Kolkata', locale: 'en-GB' };
const NEW_YORK = { timeZone: 'America/New_York', locale: 'en-US' };

describe('formatTimeLabel', () => {
  it("shows UTC and the viewer's own clock, live", () => {
    const label = formatTimeLabel(NOW, NOW, true, KOLKATA);
    expect(label.utc).toBe('14:32 UTC');
    expect(label.local).toMatch(/^20:02 /);
    expect(label.local).toMatch(/GMT\+5:30|IST/);
    expect(label.relative).toBe('Live');
    expect(label.spoken).toMatch(/^Live, 14:32 UTC, 20:02 .* local time$/);
  });

  it('says how long ago a held instant was', () => {
    const at = NOW - (3 * 60 + 28) * MINUTE;
    const label = formatTimeLabel(at, NOW, false, KOLKATA);
    expect(label.utc).toBe('11:04 UTC');
    expect(label.relative).toBe('3 h 28 min ago');
    expect(label.spoken).toMatch(/^3 hours 28 minutes ago, 11:04 UTC/);
    expect(formatTimeLabel(NOW - 28 * MINUTE, NOW, false, KOLKATA).relative).toBe('28 min ago');
    expect(formatTimeLabel(NOW - 60 * MINUTE, NOW, false, KOLKATA).spoken).toMatch(/^1 hour ago/);
    expect(formatTimeLabel(NOW - 20_000, NOW, false, KOLKATA).relative).toBe('Just now');
  });

  it("names the weekday when the local date is not the viewer's today", () => {
    // 14:32 UTC is 10:32 in New York; 20 hours earlier is 14:32 the day before.
    const sameDay = formatTimeLabel(NOW - 2 * 60 * MINUTE, NOW, false, NEW_YORK);
    expect(sameDay.local).not.toMatch(/Wed|Tue/);
    const yesterday = formatTimeLabel(NOW - 20 * 60 * MINUTE, NOW, false, NEW_YORK);
    expect(yesterday.local).toMatch(/^Wed/);
    expect(yesterday.local).toMatch(/02:32 PM EDT$/);
  });

  it("counts the date change in the viewer's zone, not UTC's", () => {
    // 19:00 UTC on 30 September is already 00:30 on 1 October in Kolkata: today there.
    const label = formatTimeLabel(Date.UTC(2026, 8, 30, 19, 0), NOW, false, KOLKATA);
    expect(label.utc).toBe('19:00 UTC');
    expect(label.local).toMatch(/^00:30 /);
  });
});
