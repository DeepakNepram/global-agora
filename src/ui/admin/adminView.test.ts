import { describe, expect, it } from 'vitest';

import type { AdminCounters } from '@/core/admin';

import {
  atCap,
  capText,
  clockTime,
  consoleMessageText,
  counterCells,
  draftProblemText,
  formatLatLon,
  formatWait,
  locationMessageText,
  suggestionNoteText,
  tabForPath,
} from './adminView';

const NOW = new Date(2026, 9, 22, 8, 0).getTime();
const COUNTERS: AdminCounters = {
  openDiscussions: 25,
  maxOpen: 25,
  nextCloseAtMs: NOW + (3 * 60 + 10) * 60_000,
  postsToday: 1234,
  reportsOpen: 2,
  medianActionSeconds: 4800,
  reportsResolved: 3,
  medianWindowDays: 7,
};

describe('the console’s words', () => {
  it('routes each tab by its path', () => {
    expect(tabForPath('/admin')).toBe('stories');
    expect(tabForPath('/admin/')).toBe('stories');
    expect(tabForPath('/admin/moderation')).toBe('moderation');
    expect(tabForPath('/admin/locations/')).toBe('locations');
    expect(tabForPath('/admin/elsewhere')).toBe('stories');
  });

  it('says how long a report waited', () => {
    expect(formatWait(null)).toBe('—');
    expect(formatWait(45)).toBe('45 s');
    expect(formatWait(720)).toBe('12 min');
    expect(formatWait(4800)).toBe('1 h 20 min');
    expect(formatWait(7200)).toBe('2 h');
    expect(formatWait(3 * 86_400)).toBe('3 days');
  });

  it('says the cap plainly, with when the next one closes', () => {
    expect(atCap(COUNTERS)).toBe(true);
    expect(atCap({ ...COUNTERS, openDiscussions: 24 })).toBe(false);
    expect(atCap(null)).toBe(false);
    expect(capText(25, COUNTERS.nextCloseAtMs, NOW)).toBe(
      `25 discussions are open, the most at once, so moderation stays manageable. ` +
        `The next one closes at ${clockTime(COUNTERS.nextCloseAtMs ?? 0)}, in 3 h 10 min.`,
    );
    expect(capText(25, NOW - 1000, NOW)).toContain('any minute now');
    expect(capText(25, null, NOW)).not.toContain('next');
    expect(capText(1, null, NOW)).toMatch(/^1 discussion is open,/);
  });

  it('lays out the four counters', () => {
    expect(counterCells(COUNTERS).map((cell) => `${cell.label}: ${cell.value}`)).toEqual([
      'Open discussions: 25 of 25',
      'Posts today: 1,234',
      'Reports open: 2',
      'Median time to act: 1 h 20 min',
    ]);
    expect(counterCells({ ...COUNTERS, reportsResolved: 0 })[3]?.detail).toBe(
      'None resolved in 7 days',
    );
  });

  it('says where the form’s words came from, and what stops them', () => {
    expect(suggestionNoteText(null, true)).toMatch(/start typing/);
    expect(suggestionNoteText('suggested', false)).toMatch(/fairly to both sides/);
    expect(suggestionNoteText('not-configured', false)).toMatch(/key is not set/);
    expect(suggestionNoteText('declined', false)).toMatch(/declined/);
    expect(draftProblemText('same-sides')).toBe('The two sides need different names.');
    expect(draftProblemText('prompt-long')).toContain('200');
  });

  it('reports what an action did', () => {
    expect(
      consoleMessageText({ kind: 'opened', title: 'Hot', closesAtMs: NOW + 48 * 3_600_000 }, NOW),
    ).toMatch(/^Opened: “Hot”\. It closes \d\d:\d\d, in 48 h\.$/);
    expect(consoleMessageText({ kind: 'gone', title: 'Hot' }, NOW)).toMatch(
      /no longer in the queue/,
    );
    expect(locationMessageText({ kind: 'moved', title: 'Hot', reports: 1 })).toContain(
      'answered 1 report.',
    );
    expect(locationMessageText({ kind: 'moved', title: 'Hot', reports: 0 })).not.toContain(
      'report',
    );
  });

  it('writes coordinates with their hemispheres', () => {
    expect(formatLatLon(12.97, 77.59)).toBe('12.9700° N, 77.5900° E');
    expect(formatLatLon(-33.8688, -151.2093)).toBe('33.8688° S, 151.2093° W');
  });
});
