import { describe, expect, it } from 'vitest';

import { discussionErrorCode, toDiscussionPost, toRoomBalance, type PostRow } from './discussion';

const ROW: PostRow = {
  id: 'p1',
  author_id: 'u1',
  body: 'A post.',
  stance: 'a',
  kind: 'expert',
  evidence_url: null,
  region_label: 'Bengaluru area, India',
  mod_state: 'ok',
  helpful_count: 3,
  cross_side_count: 1,
  changed_mind_count: 2,
  rank_score: 2.5,
  created_at: '2026-10-20T09:00:00Z',
  author: { handle: 'heron' },
};

describe('toDiscussionPost', () => {
  it('maps a row, the author’s handle included', () => {
    expect(toDiscussionPost(ROW)).toEqual({
      id: 'p1',
      authorId: 'u1',
      authorHandle: 'heron',
      body: 'A post.',
      stance: 'a',
      kind: 'expert',
      evidenceUrl: null,
      regionLabel: 'Bengaluru area, India',
      modState: 'ok',
      helpfulCount: 3,
      crossSideCount: 1,
      changedMindCount: 2,
      rankScore: 2.5,
      createdAtMs: Date.UTC(2026, 9, 20, 9),
    });
  });

  it('drops a row with a value this build does not know, rather than guessing', () => {
    expect(toDiscussionPost({ ...ROW, kind: 'rumour' })).toBeNull();
    expect(toDiscussionPost({ ...ROW, stance: 'c' })).toBeNull();
    expect(toDiscussionPost({ ...ROW, created_at: 'soon' })).toBeNull();
    expect(toDiscussionPost({ ...ROW, author: null })?.authorHandle).toBeNull();
  });
});

describe('toRoomBalance', () => {
  it('reads the rows discussion_balance returns, missing sides as 0', () => {
    expect(
      toRoomBalance([
        { stance: 'a', posts: 4 },
        { stance: 'neutral', posts: 1 },
      ]),
    ).toEqual({
      a: 4,
      b: 0,
      neutral: 1,
    });
    expect(toRoomBalance(null)).toEqual({ a: 0, b: 0, neutral: 0 });
  });
});

describe('discussionErrorCode', () => {
  it('names what the database refused', () => {
    expect(
      discussionErrorCode({ code: '42501', message: 'new row violates row-level security' }),
    ).toBe('not-allowed');
    expect(discussionErrorCode({ code: '23505', message: 'duplicate key' })).toBe('already-done');
    expect(discussionErrorCode({ code: 'PGRST303', message: 'JWT expired' })).toBe('signed-out');
    expect(discussionErrorCode({ message: 'TypeError: Failed to fetch' })).toBe('network');
    expect(discussionErrorCode({ code: 'XX000', message: 'boom' })).toBe('unknown');
  });
});
