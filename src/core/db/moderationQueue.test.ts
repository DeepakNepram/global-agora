import { describe, expect, it } from 'vitest';

import { toQueueItem } from './moderationQueue';

const ROW = {
  post_id: 'p1',
  story_id: 's1',
  prompt: 'Should the port reopen?',
  side_label: 'Reopen',
  body: 'A post',
  kind: 'expert',
  evidence_url: null,
  created_at: '2026-10-17T09:00:00Z',
  author_id: 'u1',
  author_handle: 'heron',
  author_strikes: 1,
  author_suspended: false,
  strikes_to_suspend: 3,
  queued_for: 'hidden',
  waiting_since: '2026-10-17T09:05:00Z',
  report_count: 0,
  report_reasons: {},
  toxicity: 0.72,
  flagged: [],
};

describe('toQueueItem', () => {
  it('reads a queued post', () => {
    expect(toQueueItem(ROW)).toEqual({
      postId: 'p1',
      storyId: 's1',
      prompt: 'Should the port reopen?',
      sideLabel: 'Reopen',
      body: 'A post',
      kind: 'expert',
      evidenceUrl: null,
      createdAtMs: Date.parse('2026-10-17T09:00:00Z'),
      authorId: 'u1',
      authorHandle: 'heron',
      authorStrikes: 1,
      authorSuspended: false,
      strikesToSuspend: 3,
      queuedFor: 'hidden',
      waitingSinceMs: Date.parse('2026-10-17T09:05:00Z'),
      reportCount: 0,
      reportReasons: {},
      toxicity: 0.72,
      flagged: [],
    });
  });

  it('keeps only counted reasons, and treats an unknown reason to queue as a report', () => {
    const item = toQueueItem({
      ...ROW,
      queued_for: 'something_new',
      report_reasons: { spam: 2, odd: 'x' },
      toxicity: null,
      flagged: null,
    });
    expect(item.queuedFor).toBe('reported');
    expect(item.reportReasons).toEqual({ spam: 2 });
    expect(item.toxicity).toBeNull();
    expect(item.flagged).toEqual([]);
  });
});
