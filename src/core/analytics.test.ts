import { describe, expect, it } from 'vitest';

import {
  analyticsAllowed,
  durationBucket,
  isoWeek,
  parseAnalyticsEvent,
  parseCohort,
  weekActive,
  weeksBetween,
} from './analytics';

const MIN = 60_000;
const DAY = 86_400_000;

describe('analytics', () => {
  it('buckets the time on screen', () => {
    expect(durationBucket(10_000)).toBe('<30s');
    expect(durationBucket(30_000)).toBe('30s-2m');
    expect(durationBucket(4 * MIN)).toBe('2-5m');
    expect(durationBucket(14 * MIN)).toBe('5-15m');
    expect(durationBucket(29 * MIN)).toBe('15-30m');
    expect(durationBucket(3 * 60 * MIN)).toBe('30m+');
  });

  it('names ISO weeks, across the turn of a year', () => {
    expect(isoWeek(Date.UTC(2026, 9, 25))).toBe('2026-W43'); // a Sunday
    expect(isoWeek(Date.UTC(2026, 9, 26))).toBe('2026-W44'); // the Monday after
    expect(isoWeek(Date.UTC(2027, 0, 1))).toBe('2026-W53'); // a Friday in 2026's last week
    expect(isoWeek(Date.UTC(2027, 0, 4))).toBe('2027-W01');
    expect(weeksBetween('2026-W52', '2027-W02')).toBe(3);
    expect(weeksBetween('2026-W44', '2026-W44')).toBe(0);
    expect(weeksBetween('nonsense', '2026-W44')).toBeNull();
  });

  it('counts a device once a week, as week 0 of its cohort first', () => {
    const monday = Date.UTC(2026, 9, 26, 9);
    const first = weekActive(null, monday);
    expect(first.event).toEqual({ name: 'week_active', data: { cohort: '2026-W44', week: 0 } });
    expect(weekActive(first.store, monday + 2 * DAY).event).toBeNull();
    const second = weekActive(first.store, monday + 8 * DAY);
    expect(second.event).toEqual({ name: 'week_active', data: { cohort: '2026-W44', week: 1 } });
    expect(second.store).toEqual({ cohort: '2026-W44', counted: '2026-W45' });
  });

  it('starts again from a malformed record', () => {
    expect(parseCohort({ cohort: '2026-W44', counted: '2026-W45' })).toEqual({
      cohort: '2026-W44',
      counted: '2026-W45',
    });
    expect(parseCohort({ cohort: 'yesterday', counted: '2026-W45' })).toBeNull();
    expect(parseCohort('2026-W44')).toBeNull();
  });

  it('honours Global Privacy Control, Do Not Track and the reader’s own switch', () => {
    const none = { globalPrivacyControl: false, doNotTrack: false, optedOut: false };
    expect(analyticsAllowed(none)).toBe(true);
    expect(analyticsAllowed({ ...none, globalPrivacyControl: true })).toBe(false);
    expect(analyticsAllowed({ ...none, doNotTrack: true })).toBe(false);
    expect(analyticsAllowed({ ...none, optedOut: true })).toBe(false);
  });

  it('accepts the six events in their exact shapes, and nothing else', () => {
    expect(parseAnalyticsEvent({ name: 'story_opened' })).toEqual({ name: 'story_opened' });
    expect(parseAnalyticsEvent({ name: 'session_end', data: { duration: '2-5m' } })).toEqual({
      name: 'session_end',
      data: { duration: '2-5m' },
    });
    expect(
      parseAnalyticsEvent({ name: 'week_active', data: { cohort: '2026-W44', week: 1 } }),
    ).toEqual({ name: 'week_active', data: { cohort: '2026-W44', week: 1 } });
    // Anything that could carry something personal, or just isn't ours:
    expect(parseAnalyticsEvent({ name: 'story_opened', data: { story: 12 } })).toBeNull();
    expect(parseAnalyticsEvent({ name: 'story_opened', url: '/?story=12' })).toBeNull();
    expect(parseAnalyticsEvent({ name: 'session_end', data: { duration: 123456 } })).toBeNull();
    expect(
      parseAnalyticsEvent({ name: 'week_active', data: { cohort: '2026-W44', week: 1, id: 'x' } }),
    ).toBeNull();
    expect(parseAnalyticsEvent({ name: 'pageview' })).toBeNull();
    expect(parseAnalyticsEvent(null)).toBeNull();
  });
});
