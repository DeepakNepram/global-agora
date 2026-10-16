import { describe, expect, it } from 'vitest';

import { moderationErrorCode, toNotice } from './moderation';

describe('moderationErrorCode', () => {
  it('names the database’s refusals', () => {
    expect(moderationErrorCode({ message: 'dup', code: '23505' })).toBe('already-reported');
    expect(moderationErrorCode({ message: 'gone', code: 'P0002' })).toBe('not-found');
    expect(moderationErrorCode({ message: 'no profile', code: '23503' })).toBe('not-found');
    expect(moderationErrorCode({ message: 'denied', code: '42501' })).toBe('not-allowed');
    expect(moderationErrorCode({ message: 'jwt', code: 'PGRST301' })).toBe('not-allowed');
    expect(moderationErrorCode({ message: 'removed', code: '55000' })).toBe('out-of-order');
  });

  it('tells a network failure from anything else', () => {
    expect(moderationErrorCode({ message: 'TypeError: Failed to fetch' })).toBe('network');
    expect(moderationErrorCode({ message: 'new', code: 'XX000' })).toBe('unknown');
  });
});

const ROW = {
  id: 'n1',
  post_id: 'p1',
  story_id: 's1',
  created_at: '2026-10-17T10:00:00Z',
  read_at: null,
  discussions: { prompt: 'Should the port reopen?' },
};

describe('toNotice', () => {
  it('reads a report outcome', () => {
    expect(toNotice({ ...ROW, kind: 'report_outcome', detail: { outcome: 'removed' } })).toEqual({
      id: 'n1',
      kind: 'report_outcome',
      outcome: 'removed',
      createdAtMs: Date.parse('2026-10-17T10:00:00Z'),
      readAtMs: null,
      postId: 'p1',
      storyId: 's1',
      prompt: 'Should the port reopen?',
    });
  });

  it('reads a removal with its strike and standing', () => {
    const notice = toNotice({
      ...ROW,
      kind: 'post_removed',
      read_at: '2026-10-17T11:00:00Z',
      detail: {
        source: 'auto',
        flagged: ['hate', 7],
        strike: true,
        strikes: 2,
        strikes_to_suspend: 3,
        suspended: false,
      },
    });
    expect(notice).toMatchObject({
      kind: 'post_removed',
      source: 'auto',
      flagged: ['hate'],
      strike: true,
      strikes: 2,
      strikesToSuspend: 3,
      suspended: false,
      readAtMs: Date.parse('2026-10-17T11:00:00Z'),
    });
  });

  it('keeps going when the discussion has gone or the detail is odd', () => {
    const notice = toNotice({ ...ROW, discussions: null, kind: 'post_removed', detail: null });
    expect(notice).toMatchObject({
      prompt: null,
      source: 'auto',
      flagged: [],
      strike: false,
      strikes: 0,
      strikesToSuspend: 3,
    });
  });

  it('skips a kind this build does not know', () => {
    expect(toNotice({ ...ROW, kind: 'something_new', detail: {} })).toBeNull();
  });
});
