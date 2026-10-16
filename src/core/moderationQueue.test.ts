import { describe, expect, it } from 'vitest';

import {
  QUEUED_FOR_LABEL,
  reportReasonLabel,
  reportSummary,
  strikeConsequence,
  type QueueItem,
} from './moderationQueue';

const ITEM: QueueItem = {
  postId: 'p1',
  storyId: 's1',
  prompt: 'Should the port reopen?',
  sideLabel: 'Reopen',
  body: 'A post',
  kind: 'argument',
  evidenceUrl: null,
  createdAtMs: 0,
  authorId: 'u1',
  authorHandle: 'heron',
  authorStrikes: 0,
  authorSuspended: false,
  strikesToSuspend: 3,
  queuedFor: 'reported',
  waitingSinceMs: 0,
  reportCount: 3,
  reportReasons: { spam: 1, harassment: 2 },
  toxicity: null,
  flagged: [],
};

describe('the queue’s words', () => {
  it('names the reasons as the report sheet does', () => {
    expect(reportReasonLabel('false_expertise')).toBe('False expertise claim');
    expect(reportReasonLabel('off_topic')).toBe('Off-topic');
    expect(reportReasonLabel('something_new')).toBe('something_new');
  });

  it('sums up the open reports, most first', () => {
    expect(reportSummary(ITEM.reportReasons)).toBe('Harassment ×2, Spam');
    expect(reportSummary({})).toBe('');
  });

  it('says what a strike will do before it is given', () => {
    expect(strikeConsequence(ITEM)).toBe('This is strike 1 of 3 for @heron.');
    expect(strikeConsequence({ ...ITEM, authorStrikes: 2 })).toBe(
      'This is strike 3 of 3: it suspends @heron.',
    );
    expect(strikeConsequence({ ...ITEM, authorStrikes: 3, authorSuspended: true })).toBe(
      '@heron is already suspended.',
    );
  });

  it('says why each post is queued', () => {
    expect(QUEUED_FOR_LABEL).toEqual({
      hidden: 'Held by the toxicity check',
      reported: 'Reported',
      unchecked: 'Not checked by the models',
    });
  });
});
