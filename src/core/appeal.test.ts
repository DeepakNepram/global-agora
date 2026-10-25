import { describe, expect, it } from 'vitest';

import { appealStanding, type AppealSummary } from './appeal';

const DAY = 86_400_000;
const NOW = 100 * DAY;

function appeal(overrides: Partial<AppealSummary>): AppealSummary {
  return { status: 'pending', sentAtMs: NOW - DAY, reply: null, againAtMs: null, ...overrides };
}

describe('appealStanding', () => {
  it('offers nothing to an account in good standing', () => {
    expect(appealStanding(null, null, NOW)).toEqual({ kind: 'none' });
    expect(appealStanding(null, appeal({ status: 'granted' }), NOW)).toEqual({ kind: 'none' });
  });

  it('lets a suspended account appeal, and shows one waiting', () => {
    expect(appealStanding(NOW - DAY, null, NOW)).toEqual({
      kind: 'can-appeal',
      refusedReply: null,
    });
    expect(appealStanding(NOW - DAY, appeal({}), NOW)).toEqual({
      kind: 'pending',
      sentAtMs: NOW - DAY,
    });
  });

  it('after a refusal, waits, then offers another with the last reply', () => {
    const refused = appeal({ status: 'refused', reply: 'No.', againAtMs: NOW + 5 * DAY });
    expect(appealStanding(NOW - 9 * DAY, refused, NOW)).toEqual({
      kind: 'wait',
      reply: 'No.',
      againAtMs: NOW + 5 * DAY,
    });
    expect(appealStanding(NOW - 9 * DAY, refused, NOW + 6 * DAY)).toEqual({
      kind: 'can-appeal',
      refusedReply: 'No.',
    });
  });

  it('treats a new suspension after a granted appeal as a fresh one', () => {
    const granted = appeal({ status: 'granted', reply: 'Fair.' });
    expect(appealStanding(NOW - DAY, granted, NOW)).toEqual({
      kind: 'can-appeal',
      refusedReply: null,
    });
  });
});
