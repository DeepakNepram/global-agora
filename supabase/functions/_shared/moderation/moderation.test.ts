import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseGoogleModeration, toxicConfidence } from './googleText.ts';
import { parseOpenAIModeration } from './openai.ts';
import { ProviderError } from './provider.ts';
import { MODERATION_SAMPLES } from './samples.ts';
import { moderationSignals } from './signals.ts';

interface Fixture {
  readonly source: string;
  readonly reply: unknown;
}
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'),
) as Record<string, { openai: Fixture; google: Fixture }>;

function signalsFor(id: string): { flagged: readonly string[]; toxicity: number } {
  const fixture = fixtures[id];
  if (fixture === undefined) throw new Error(`no fixture for ${id}`);
  return moderationSignals(
    parseOpenAIModeration(fixture.openai.reply),
    parseGoogleModeration(fixture.google.reply),
  );
}

describe('moderation samples and fixtures', () => {
  it('pairs every sample with both models’ replies, and nothing else', () => {
    expect(Object.keys(fixtures).sort()).toEqual(MODERATION_SAMPLES.map((s) => s.id).sort());
  });

  it('says where each reply came from', () => {
    for (const fixture of Object.values(fixtures)) {
      for (const reply of [fixture.openai, fixture.google]) {
        expect(reply.source).toMatch(/^(hand-written|recorded \d{4}-\d{2}-\d{2})$/);
      }
    }
  });

  it('keeps every sample a postable length (the posts CHECK: 1 to 500 code points)', () => {
    for (const sample of MODERATION_SAMPLES) {
      expect([...sample.text].length).toBeGreaterThan(0);
      expect([...sample.text].length).toBeLessThanOrEqual(500);
    }
  });

  it('has toxic samples flagged and benign ones clean in the replies', () => {
    for (const sample of MODERATION_SAMPLES) {
      const signals = signalsFor(sample.id);
      if (sample.expect === 'ok') expect(signals.flagged, sample.id).toEqual([]);
      if (sample.expect.startsWith('removed')) {
        expect(signals.flagged.length, sample.id).toBeGreaterThan(0);
      }
    }
  });
});

describe('parseOpenAIModeration', () => {
  it('reads a reply and keeps all of it', () => {
    const reply = fixtures.threat?.openai.reply;
    expect(parseOpenAIModeration(reply)).toBe(reply);
  });

  it.each([
    ['nothing', null],
    ['no results', { model: 'm', results: [] }],
    ['no model', { results: [{ flagged: false, categories: {}, category_scores: {} }] }],
    [
      'a score that is not a number',
      {
        model: 'm',
        results: [{ flagged: false, categories: {}, category_scores: { hate: 'low' } }],
      },
    ],
  ])('refuses %s', (_label, reply) => {
    expect(() => parseOpenAIModeration(reply)).toThrow(ProviderError);
  });
});

describe('parseGoogleModeration and toxicConfidence', () => {
  it('reads Toxic', () => {
    expect(toxicConfidence(parseGoogleModeration(fixtures.threat?.google.reply))).toBe(0.92);
  });

  it('refuses a reply without categories, or without Toxic', () => {
    expect(() => parseGoogleModeration({})).toThrow(ProviderError);
    const noToxic = parseGoogleModeration({
      moderationCategories: [{ name: 'Insult', confidence: 1 }],
    });
    expect(() => toxicConfidence(noToxic)).toThrow(/no Toxic/);
    const outOfRange = parseGoogleModeration({
      moderationCategories: [{ name: 'Toxic', confidence: 1.2 }],
    });
    expect(() => toxicConfidence(outOfRange)).toThrow(ProviderError);
  });
});

describe('moderationSignals', () => {
  it('lists the flagged categories, sorted, and Google’s Toxic', () => {
    expect(signalsFor('hate')).toEqual({
      flagged: ['harassment', 'hate', 'hate/threatening', 'violence'],
      toxicity: 0.9,
    });
    expect(signalsFor('self-harm').flagged).toEqual(['self-harm', 'self-harm/intent']);
    expect(signalsFor('argument')).toEqual({ flagged: [], toxicity: 0.05 });
  });

  it('fails closed when OpenAI flags without naming a category', () => {
    const openai = parseOpenAIModeration({
      model: 'm',
      results: [{ flagged: true, categories: { hate: false }, category_scores: { hate: 0.4 } }],
    });
    const google = parseGoogleModeration({
      moderationCategories: [{ name: 'Toxic', confidence: 0 }],
    });
    expect(moderationSignals(openai, google).flagged).toEqual(['unspecified']);
  });
});
