import { describe, expect, it } from 'vitest';

import { newsAgeText, SAVED_AT_HEADER, savedAtFrom } from './saved';

const HOUR = 3_600_000;

describe('saved news', () => {
  it('reads the saved mark as the saved reply’s date', () => {
    const date = 'Sat, 24 Oct 2026 21:00:00 GMT';
    expect(savedAtFrom(new Headers({ [SAVED_AT_HEADER]: date }))).toBe(Date.parse(date));
  });

  it('treats an unreadable mark as saved at an unknown time, and no mark as fresh', () => {
    expect(savedAtFrom(new Headers({ [SAVED_AT_HEADER]: 'unknown' }))).toBe(0);
    expect(savedAtFrom(new Headers())).toBeNull();
  });

  it('says how old the newest story is in words', () => {
    const now = 100 * HOUR;
    expect(newsAgeText(now - 10 * 60_000, now)).toBe('less than an hour ago');
    expect(newsAgeText(now - 90 * 60_000, now)).toBe('an hour ago');
    expect(newsAgeText(now - 3 * HOUR - 1, now)).toBe('3 hours ago');
    expect(newsAgeText(now - 47 * HOUR, now)).toBe('47 hours ago');
    expect(newsAgeText(now - 50 * HOUR, now)).toBe('2 days ago');
    // A clock behind the server's never reads as the future.
    expect(newsAgeText(now + HOUR, now)).toBe('less than an hour ago');
  });
});
