import { describe, expect, it } from 'vitest';

import {
  appendPage,
  byRank,
  discussionTopic,
  evidenceUrlProblem,
  insertByRank,
  postLength,
  roomShares,
  EVIDENCE_URL_MAX_CHARS,
} from './discussion';
import { fixturePost, fixturePosts } from './discussion.fixture';

describe('postLength', () => {
  it('counts code points, as char_length does, not UTF-16 units', () => {
    expect(postLength('hello')).toBe(5);
    expect(postLength('👍🏽')).toBe(2);
    expect('👍🏽'.length).toBe(4);
    expect(postLength('ನಮಸ್ಕಾರ')).toBe(7);
    expect(postLength('')).toBe(0);
  });
});

describe('evidenceUrlProblem', () => {
  it('wants an http(s) link the database CHECK accepts', () => {
    expect(evidenceUrlProblem('https://example.org/report')).toBeNull();
    expect(evidenceUrlProblem('  http://example.org  ')).toBeNull();
    expect(evidenceUrlProblem('')).toBe('missing');
    expect(evidenceUrlProblem('   ')).toBe('missing');
    expect(evidenceUrlProblem('example.org/report')).toBe('not-a-link');
    expect(evidenceUrlProblem('javascript:alert(1)')).toBe('not-a-link');
    expect(evidenceUrlProblem('ftp://example.org')).toBe('not-a-link');
    expect(evidenceUrlProblem(`https://example.org/${'a'.repeat(EVIDENCE_URL_MAX_CHARS)}`)).toBe(
      'too-long',
    );
  });
});

describe('rank order', () => {
  it('sorts by rank, then newest, then id', () => {
    const high = { ...fixturePost(0), rankScore: 3 };
    const tieOld = { ...fixturePost(1), rankScore: 1, createdAtMs: 1000 };
    const tieNew = { ...fixturePost(2), rankScore: 1, createdAtMs: 2000 };
    expect([tieOld, high, tieNew].sort(byRank).map((post) => post.id)).toEqual([
      high.id,
      tieNew.id,
      tieOld.id,
    ]);
  });

  it('inserts a new post at its rank place, and replaces a copy instead of duplicating it', () => {
    const list = fixturePosts(5);
    const fresh = { ...fixturePost(59), rankScore: 0, createdAtMs: Date.UTC(2026, 9, 21) };
    const placed = insertByRank(list, fresh);
    expect(placed.index).toBe(5);
    expect(placed.list.at(-1)?.id).toBe(fresh.id);

    const rising = { ...list[3]!, rankScore: 99 };
    const again = insertByRank(placed.list, rising);
    expect(again.index).toBe(0);
    expect(again.list.filter((post) => post.id === rising.id)).toHaveLength(1);
    expect(again.list).toHaveLength(6);
  });

  it('appends a page without repeating posts already shown', () => {
    const first = [0, 1, 2, 3].map((i) => fixturePost(i));
    const page = [fixturePost(3), fixturePost(4), fixturePost(5)];
    expect(appendPage(first, page).map((post) => post.id)).toEqual(
      [0, 1, 2, 3, 4, 5].map((i) => fixturePost(i).id),
    );
  });
});

describe('roomShares', () => {
  it('adds up to exactly 100 by largest remainder', () => {
    expect(roomShares({ a: 1, b: 1, neutral: 1 })).toEqual({ a: 34, b: 33, neutral: 33, total: 3 });
    expect(roomShares({ a: 2, b: 1, neutral: 0 })).toEqual({ a: 67, b: 33, neutral: 0, total: 3 });
    for (const balance of [
      { a: 7, b: 3, neutral: 1 },
      { a: 1, b: 1, neutral: 5 },
      { a: 333, b: 333, neutral: 334 },
    ]) {
      const shares = roomShares(balance);
      expect(shares.a + shares.b + shares.neutral).toBe(100);
    }
  });

  it('is all zero for an empty room', () => {
    expect(roomShares({ a: 0, b: 0, neutral: 0 })).toEqual({ a: 0, b: 0, neutral: 0, total: 0 });
  });
});

describe('discussionTopic', () => {
  it("names the database's broadcast topic", () => {
    expect(discussionTopic('abc')).toBe('discussion:abc');
  });
});

describe('the fixture', () => {
  it('comes best first, with every side and kind', () => {
    const posts = fixturePosts();
    expect([...posts].sort(byRank)).toEqual(posts);
    expect(new Set(posts.map((post) => post.stance))).toEqual(new Set(['a', 'b', 'neutral']));
    expect(new Set(posts.map((post) => post.kind)).size).toBe(4);
  });
});
