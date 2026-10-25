import { describe, expect, it } from 'vitest';

import { ANALYTICS_OPT_OUT_KEY } from '@/core';

import { createAnalyticsConsentStore } from './analyticsConsent';
import type { KeyValueStorage } from './persist';

function memory(): KeyValueStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('analyticsConsent', () => {
  it('counts unless turned off, and remembers the choice on the device', () => {
    const storage = memory();
    const store = createAnalyticsConsentStore(storage);
    expect(store.getState().counting).toBe(true);
    store.getState().setCounting(false);
    expect(storage.values.get(ANALYTICS_OPT_OUT_KEY)).toBe('{"count":false}');
    expect(createAnalyticsConsentStore(storage).getState().counting).toBe(false);
  });
});
