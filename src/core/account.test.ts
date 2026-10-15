import { describe, expect, it } from 'vitest';

import { authProvidersFromEnv } from './account';
import { needsRulesAgreement, COMMUNITY_RULES, RULES_UPDATED_AT_MS } from './communityRules';

describe('authProvidersFromEnv', () => {
  it('offers email alone until others are set up', () => {
    expect(authProvidersFromEnv({})).toEqual(['email']);
    expect(authProvidersFromEnv({ VITE_AUTH_PROVIDERS: '  ' })).toEqual(['email']);
  });

  it('offers what is listed, in the sheet order, without repeats or unknowns', () => {
    expect(authProvidersFromEnv({ VITE_AUTH_PROVIDERS: 'email, Google,apple,google' })).toEqual([
      'google',
      'apple',
      'email',
    ]);
    expect(authProvidersFromEnv({ VITE_AUTH_PROVIDERS: 'google,github' })).toEqual(['google']);
  });
});

describe('needsRulesAgreement', () => {
  it('asks an account that never agreed', () => {
    expect(needsRulesAgreement(null)).toBe(true);
  });

  it('asks again only when the rules changed after the agreement', () => {
    expect(needsRulesAgreement(RULES_UPDATED_AT_MS + 1000)).toBe(false);
    expect(needsRulesAgreement(RULES_UPDATED_AT_MS - 1000)).toBe(true);
    expect(needsRulesAgreement(5_000, 10_000)).toBe(true);
  });

  it('has rules to agree to', () => {
    expect(COMMUNITY_RULES.length).toBeGreaterThan(0);
    for (const rule of COMMUNITY_RULES) {
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.detail.length).toBeGreaterThan(0);
    }
  });
});
