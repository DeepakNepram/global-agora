import { describe, expect, it } from 'vitest';

import { FREE_TIER_DEFAULTS, resolveConfig } from './config';

describe('resolveConfig', () => {
  it('falls back to free-tier defaults when the env is empty', () => {
    expect(resolveConfig({})).toEqual(FREE_TIER_DEFAULTS);
  });

  it('reads overrides from the env bag', () => {
    const config = resolveConfig({
      VITE_HISTORY_WINDOW_HOURS: '168',
      VITE_API_BASE_URL: 'https://api.example.com',
    });

    expect(config.historyWindowHours).toBe(168);
    expect(config.apiBaseUrl).toBe('https://api.example.com');
    // Unset keys keep their defaults rather than becoming NaN/undefined.
    expect(config.maxPostLength).toBe(500);
  });

  it('ignores unparseable or non-positive values instead of propagating NaN', () => {
    const config = resolveConfig({ VITE_ALERT_LIMIT: 'lots', VITE_SAVED_STORY_LIMIT: '-3' });

    expect(config.alertLimit).toBe(FREE_TIER_DEFAULTS.alertLimit);
    expect(config.savedStoryLimit).toBe(FREE_TIER_DEFAULTS.savedStoryLimit);
  });
});
