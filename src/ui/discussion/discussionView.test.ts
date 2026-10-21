import { describe, expect, it } from 'vitest';

import { FIXTURE_DISCUSSION } from '@/core/discussion.fixture';

import {
  closingText,
  counterAnnouncement,
  counterView,
  kindChip,
  linkHost,
  sendResultText,
  sharesText,
  sideName,
  voteLabel,
  voteResultText,
  waitText,
} from './discussionView';

describe('kindChip', () => {
  it('always marks Expert as self-declared and unverified', () => {
    expect(kindChip('expert')).toBe('Expert · self-declared, unverified');
    expect(kindChip('evidence')).toBe('Evidence');
  });
});

describe('sideName', () => {
  it('uses the debate’s own labels', () => {
    expect(sideName('a', FIXTURE_DISCUSSION)).toBe('Move it');
    expect(sideName('b', FIXTURE_DISCUSSION)).toBe('Keep it where it is');
    expect(sideName('neutral', FIXTURE_DISCUSSION)).toBe('Neutral');
  });
});

describe('the counter', () => {
  it('counts emoji as the database does', () => {
    expect(counterView('👍🏽 ok').text).toBe('5/500');
    expect(counterView('x'.repeat(501))).toMatchObject({ over: true, near: true });
    expect(counterView('x'.repeat(449)).near).toBe(false);
  });

  it('speaks only as the count crosses 50 left, 10 left and the limit', () => {
    expect(counterAnnouncement(449, 450)).toBe('50 characters left.');
    expect(counterAnnouncement(450, 451)).toBeNull();
    expect(counterAnnouncement(489, 490)).toBe('10 characters left.');
    expect(counterAnnouncement(500, 501)).toBe('Over the 500 character limit.');
    expect(counterAnnouncement(501, 502)).toBeNull();
    expect(counterAnnouncement(10, 30)).toBeNull();
  });
});

describe('copy', () => {
  it('tells the wait as minutes and seconds', () => {
    expect(waitText(42)).toBe('0:42');
    expect(waitText(61.2)).toBe('1:02');
  });

  it('explains what happened to a post', () => {
    expect(sendResultText({ ok: true, badgeDropped: false })).toMatch(/once it has been checked/);
    expect(sendResultText({ ok: true, badgeDropped: true })).toMatch(/without an area/);
    expect(sendResultText({ ok: false, code: 'no-side' })).toBe('Pick a side first.');
  });

  it('names votes with their counts, and explains refusals', () => {
    expect(voteLabel('changed_mind', 1234)).toBe('Changed my mind, 1,234');
    expect(voteResultText('no-side', 'helpful')).toMatch(/Pick a side/);
    expect(voteResultText('already', 'helpful')).toBeNull();
  });

  it('gives the balance in words as well as colour', () => {
    expect(sharesText({ a: 58, b: 30, neutral: 12, total: 43 }, FIXTURE_DISCUSSION)).toBe(
      'Move it 58%, Neutral 12%, Keep it where it is 30%, of 43 posts.',
    );
    expect(sharesText({ a: 0, b: 0, neutral: 0, total: 0 }, FIXTURE_DISCUSSION)).toBe(
      'No posts yet.',
    );
  });

  it('shows a link by its host', () => {
    expect(linkHost('https://www.example.org/report/7')).toBe('example.org');
  });

  it('counts down to the close', () => {
    const closes = FIXTURE_DISCUSSION.closesAtMs;
    expect(closingText(FIXTURE_DISCUSSION, closes - 30 * 3_600_000 - 1)).toBe('Closes in 31 h.');
    expect(closingText(FIXTURE_DISCUSSION, closes - 1000)).toBe('Closes within the hour.');
    expect(closingText(FIXTURE_DISCUSSION, closes)).toBe('This discussion has closed.');
  });
});
