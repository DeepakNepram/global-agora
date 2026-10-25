import { describe, expect, it } from 'vitest';

import { toAdminAppeal } from './appeals';

describe('toAdminAppeal', () => {
  it('reads a row of admin_appeals()', () => {
    const appeal = toAdminAppeal({
      id: 'a1',
      handle: 'heron_one',
      body: 'It was a quotation.',
      status: 'pending',
      created_at: '2026-10-25T10:00:00Z',
      decided_at: null,
      reply: null,
      strikes: 3,
      suspended_at: '2026-10-24T10:00:00Z',
      removed_posts: [
        { body: 'quoted line', created_at: '2026-10-24T09:00:00Z' },
        { body: 42 },
        null,
      ],
    });
    expect(appeal).toEqual({
      id: 'a1',
      handle: 'heron_one',
      body: 'It was a quotation.',
      status: 'pending',
      createdAtMs: Date.parse('2026-10-25T10:00:00Z'),
      decidedAtMs: null,
      reply: null,
      strikes: 3,
      suspended: true,
      removedPosts: [{ body: 'quoted line', createdAtMs: Date.parse('2026-10-24T09:00:00Z') }],
    });
  });
});
