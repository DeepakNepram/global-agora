import { describe, expect, it } from 'vitest';

import { discussCopy, formatAgo, formatKm, sourcesText } from './format';

const NOW = Date.UTC(2026, 9, 1, 12);
const MIN = 60_000;

describe('story copy', () => {
  it('says how long ago', () => {
    expect(formatAgo(NOW - 30_000, NOW)).toBe('Just now');
    expect(formatAgo(NOW + 5 * MIN, NOW)).toBe('Just now');
    expect(formatAgo(NOW - 12 * MIN, NOW)).toBe('12 min ago');
    expect(formatAgo(NOW - 59 * MIN, NOW)).toBe('59 min ago');
    expect(formatAgo(NOW - 200 * MIN, NOW)).toBe('3 h ago');
  });

  it('says how far and how many', () => {
    expect(formatKm(0.3)).toBe('Under 1 km');
    expect(formatKm(339.6)).toBe('340 km');
    expect(formatKm(1234)).toBe('1,234 km');
    expect(sourcesText(1)).toBe('Covered by 1 source');
    expect(sourcesText(1200)).toBe('Covered by 1,200 sources');
  });

  it('never hides Discuss, and says why it is greyed', () => {
    expect(discussCopy('open', 12)).toEqual({ enabled: true, label: 'Discuss · 12 taking part' });
    expect(discussCopy('open', null)).toEqual({ enabled: true, label: 'Discuss' });
    expect(discussCopy('queued', null)).toEqual({
      enabled: false,
      label: 'Discussion not open yet',
    });
    expect(discussCopy('none', null).label).toBe('Discussion not open yet');
    expect(discussCopy('closed', 40)).toEqual({ enabled: false, label: 'Discussion closed' });
  });
});
