import { describe, expect, it } from 'vitest';

import {
  charCount,
  cleanDraft,
  draftProblem,
  localMidnight,
  PROMPT_MAX_CHARS,
  SIDE_MAX_CHARS,
  storySeqFrom,
} from './admin';
import { encodePermalink, PERMALINK_PARAMS } from './permalink';

const DRAFT = { prompt: 'Should the city ban cars?', sideA: 'Ban them', sideB: 'Keep them' };

describe('draftProblem', () => {
  it('opens a draft that fits the panel', () => {
    expect(draftProblem(DRAFT)).toBeNull();
    expect(draftProblem({ ...DRAFT, prompt: 'x'.repeat(PROMPT_MAX_CHARS) })).toBeNull();
    expect(draftProblem({ ...DRAFT, sideA: '🙂'.repeat(SIDE_MAX_CHARS) })).toBeNull();
  });

  it('names the first thing in the way, as the form reads top to bottom', () => {
    expect(draftProblem({ ...DRAFT, prompt: '  ' })).toBe('prompt-empty');
    expect(draftProblem({ ...DRAFT, prompt: 'x'.repeat(PROMPT_MAX_CHARS + 1) })).toBe(
      'prompt-long',
    );
    expect(draftProblem({ ...DRAFT, sideB: '' })).toBe('side-empty');
    expect(draftProblem({ ...DRAFT, sideA: '🙂'.repeat(SIDE_MAX_CHARS + 1) })).toBe('side-long');
    expect(draftProblem({ ...DRAFT, sideB: ' ban  THEM ' })).toBe('same-sides');
  });
});

describe('cleanDraft and charCount', () => {
  it('sends one trimmed, single-spaced line, counted as Postgres counts', () => {
    expect(cleanDraft({ prompt: ' Should\nit  go? ', sideA: ' Yes', sideB: 'No ' })).toEqual({
      prompt: 'Should it go?',
      sideA: 'Yes',
      sideB: 'No',
    });
    expect(charCount('🙂🙂')).toBe(2);
  });
});

describe('localMidnight', () => {
  it('is the start of the local day, not later than now', () => {
    const now = new Date(2026, 9, 22, 8, 15, 30).getTime();
    expect(localMidnight(now)).toBe(new Date(2026, 9, 22).getTime());
    expect(localMidnight(new Date(2026, 9, 22).getTime())).toBe(new Date(2026, 9, 22).getTime());
  });
});

describe('storySeqFrom', () => {
  it('reads a pasted permalink or a bare number', () => {
    const link = encodePermalink('https://agora.example/', {
      story: 23904,
      camera: { lat: 51.5, lon: -0.13, altitudeKm: 1200 },
      timeMs: null,
    });
    expect(storySeqFrom(link)).toBe(23904);
    expect(storySeqFrom(' 42 ')).toBe(42);
    expect(storySeqFrom('https://agora.example/?cam=1,2,3&story=7')).toBe(7);
  });

  it('refuses anything else', () => {
    expect(storySeqFrom('')).toBeNull();
    expect(storySeqFrom('London')).toBeNull();
    expect(storySeqFrom('0')).toBeNull();
    expect(storySeqFrom('99999999999999999999')).toBeNull();
  });

  it('agrees with the permalink on the parameter’s name', () => {
    expect(PERMALINK_PARAMS.story).toBe('story');
  });
});
