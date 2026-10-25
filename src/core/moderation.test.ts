import { describe, expect, it } from 'vitest';

import {
  describeNotice,
  HELP_LINK,
  rateLimitWait,
  type PostRemovedNotice,
  type ReportOutcomeNotice,
} from './moderation';

const BASE = {
  id: 'n1',
  createdAtMs: 0,
  readAtMs: null,
  postId: 'p1',
  storyId: 's1',
  prompt: 'Should the port reopen?',
};

function removed(overrides: Partial<PostRemovedNotice> = {}): PostRemovedNotice {
  return {
    ...BASE,
    kind: 'post_removed',
    source: 'auto',
    flagged: ['harassment'],
    strike: true,
    strikes: 1,
    strikesToSuspend: 3,
    suspended: false,
    ...overrides,
  };
}

describe('describeNotice', () => {
  it('tells an account how its appeal went, with the reply (Prompt 5.2)', () => {
    const base = { ...BASE, postId: null, storyId: null, prompt: null };
    const granted = describeNotice({
      ...base,
      kind: 'appeal_outcome',
      granted: true,
      reply: 'Fair.',
    });
    expect(granted.title).toBe('Appeal granted');
    expect(granted.body).toMatch(/can post, vote and take sides again/);
    expect(granted.body).toMatch(/“Fair\.”/);
    const refused = describeNotice({
      ...base,
      kind: 'appeal_outcome',
      granted: false,
      reply: 'No.',
    });
    expect(refused.title).toBe('Appeal refused');
    expect(refused.body).toMatch(/the suspension stays/);
  });

  it('tells a reporter the outcome, and nothing about the author', () => {
    const kept: ReportOutcomeNotice = { ...BASE, kind: 'report_outcome', outcome: 'kept' };
    expect(describeNotice(kept)).toEqual({
      title: 'Report reviewed',
      body:
        'We reviewed the post you reported in “Should the port reopen?”. It does not break ' +
        'the community rules, so it stays up.',
    });
    expect(describeNotice({ ...kept, outcome: 'removed' }).body).toBe(
      'Thanks for your report. We removed the post in “Should the port reopen?”.',
    );
  });

  it('names a discussion that has gone as "a discussion"', () => {
    expect(
      describeNotice({ ...BASE, prompt: null, kind: 'report_outcome', outcome: 'removed' }).body,
    ).toContain('in a discussion.');
  });

  it('tells an author why, in plain words, and where they stand', () => {
    const text = describeNotice(removed({ flagged: ['harassment', 'harassment/threatening'] }));
    expect(text.title).toBe('Your post was removed');
    expect(text.body).toBe(
      'Your post in “Should the port reopen?” is not public. Our automatic check found it ' +
        'breaks the community rules (harassment, threats). This is strike 1 of 3.',
    );
    expect(text.help).toBeUndefined();
  });

  it('warns at one strike from suspension, and says when it has happened', () => {
    expect(describeNotice(removed({ strikes: 2 })).body).toContain(
      'This is strike 2 of 3. One more suspends posting and voting.',
    );
    expect(describeNotice(removed({ strikes: 3, suspended: true })).body).toContain(
      'This is strike 3 of 3. Your account can no longer post, vote or take sides.',
    );
  });

  it('says a moderator removed it, or that the toxicity check did', () => {
    expect(describeNotice(removed({ source: 'moderator', flagged: [] })).body).toContain(
      'A moderator removed it for breaking the community rules.',
    );
    expect(describeNotice(removed({ flagged: [] })).body).toContain(
      'Our automatic check found it breaks the community rules. This',
    );
    expect(describeNotice(removed({ strike: false, flagged: [] })).body).toContain(
      'There is no strike for this.',
    );
  });

  it('meets a self-harm post with help, not a strike', () => {
    const text = describeNotice(removed({ flagged: ['self-harm/intent'], strike: false }));
    expect(text.body).toContain('talked about self-harm, so it is not public');
    expect(text.body).toContain('There is no strike for this.');
    expect(text.body).not.toMatch(/broke|breaks the community rules/);
    expect(text.help).toEqual(HELP_LINK);
    expect(HELP_LINK.href).toBe('https://findahelpline.com');
  });

  it('still offers help when self-harm came with something that struck', () => {
    const text = describeNotice(removed({ flagged: ['harassment', 'self-harm'], strike: true }));
    expect(text.body).toContain('strike 1 of 3');
    expect(text.help).toEqual(HELP_LINK);
  });
});

describe('rateLimitWait', () => {
  it('reads the wait from a PT429 detail', () => {
    const details = '{"retry_after_seconds": 27, "limit": "spacing", "posts_per_hour": 5}';
    expect(rateLimitWait({ code: 'PT429', details })).toBe(27);
  });

  it('falls back to a minute when the detail is unreadable', () => {
    expect(rateLimitWait({ code: 'PT429', details: 'nope' })).toBe(60);
    expect(rateLimitWait({ code: 'PT429', details: null })).toBe(60);
  });

  it('is null for any other error', () => {
    expect(rateLimitWait({ code: '42501', details: '{"retry_after_seconds": 5}' })).toBeNull();
    expect(rateLimitWait({})).toBeNull();
  });
});
