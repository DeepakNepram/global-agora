import { describe, expect, it } from 'vitest';

import {
  handleProblem,
  isHandleReserved,
  normalizeHandle,
  suggestHandles,
  HANDLE_PATTERN,
} from './handles';

/** A deterministic Random: a linear congruential generator. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

describe('normalizeHandle', () => {
  it('trims, drops a leading @ and lower-cases', () => {
    expect(normalizeHandle('  @Amber_Heron  ')).toBe('amber_heron');
  });

  it('keeps everything else for handleProblem to judge', () => {
    expect(normalizeHandle('amber heron')).toBe('amber heron');
  });
});

describe('handleProblem', () => {
  it('accepts a valid handle', () => {
    expect(handleProblem('amber_heron_42')).toBeNull();
    expect(handleProblem('abc')).toBeNull();
    expect(handleProblem('a'.repeat(20))).toBeNull();
  });

  it('explains what is wrong, one thing at a time', () => {
    expect(handleProblem('ab')).toBe('At least 3 characters.');
    expect(handleProblem('a'.repeat(21))).toBe('At most 20 characters.');
    expect(handleProblem('9lives')).toBe('Start with a letter.');
    expect(handleProblem('_amber')).toBe('Start with a letter.');
    expect(handleProblem('amber heron')).toBe('Only letters, digits and _.');
    expect(handleProblem('amber-heron')).toBe('Only letters, digits and _.');
    expect(handleProblem('café')).toBe('Only letters, digits and _.');
    expect(handleProblem('moderator')).toBe('That one is reserved.');
  });

  it('agrees with HANDLE_PATTERN on everything that is not reserved', () => {
    for (const handle of [
      'abc',
      'ab',
      'Abc',
      'a_1',
      '1ab',
      'a b',
      'abcdefghijklmnopqrst',
      'x'.repeat(21),
    ]) {
      expect(handleProblem(handle) === null).toBe(HANDLE_PATTERN.test(handle));
    }
  });
});

describe('isHandleReserved', () => {
  it('reserves exact words', () => {
    expect(isHandleReserved('admin')).toBe(true);
    expect(isHandleReserved('verified')).toBe(true);
    expect(isHandleReserved('verified_fan')).toBe(false);
  });

  it('reserves anything that looks like staff', () => {
    expect(isHandleReserved('agora_news')).toBe(true);
    expect(isHandleReserved('official_bbc')).toBe(true);
    expect(isHandleReserved('support_desk')).toBe(true);
    expect(isHandleReserved('team_red')).toBe(true);
    expect(isHandleReserved('teamwork')).toBe(false);
  });
});

describe('suggestHandles', () => {
  it('suggests distinct, valid, unreserved handles', () => {
    const random = seeded(7);
    for (let round = 0; round < 200; round++) {
      const handles = suggestHandles(random, 3);
      expect(handles).toHaveLength(3);
      expect(new Set(handles).size).toBe(3);
      for (const handle of handles) {
        expect(handle).toMatch(/^[a-z]+_[a-z]+_\d{2}$/);
        expect(handleProblem(handle)).toBeNull();
      }
    }
  });

  it('is deterministic for a given source of randomness', () => {
    expect(suggestHandles(seeded(1), 3)).toEqual(suggestHandles(seeded(1), 3));
  });

  it('gives up rather than loop when the randomness repeats itself', () => {
    expect(suggestHandles(() => 0, 3)).toEqual(['amber_atlas_00']);
  });
});
