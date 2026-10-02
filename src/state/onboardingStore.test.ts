import { describe, expect, it } from 'vitest';

import {
  createOnboardingStore,
  ONBOARDING_AFTER_SECONDS,
  ONBOARDING_STORAGE_KEY,
} from './onboardingStore';
import type { KeyValueStorage } from './persist';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const TOKYO = { id: 1159151609, label: 'Tokyo, Japan', lat: 35.69, lon: 139.75 };

describe('onboardingStore', () => {
  it('counts visible use across visits, writing every ten seconds', () => {
    const storage = memoryStorage();
    const store = createOnboardingStore(storage);
    for (let s = 0; s < 9; s++) store.getState().addUse(1);
    expect(storage.data[ONBOARDING_STORAGE_KEY]).toBeUndefined();
    store.getState().addUse(1);
    expect(JSON.parse(storage.data[ONBOARDING_STORAGE_KEY] ?? '{}').usedSeconds).toBe(10);
    // A later visit carries on from there.
    expect(createOnboardingStore(storage).getState().usedSeconds).toBe(10);
    expect(ONBOARDING_AFTER_SECONDS).toBe(60);
  });

  it('shows once: never again after it is done or skipped', () => {
    const storage = memoryStorage();
    const store = createOnboardingStore(storage);
    store.getState().show();
    expect(store.getState().open).toBe(true);
    store.getState().finish('skipped');
    expect(store.getState().open).toBe(false);
    store.getState().show();
    expect(store.getState().open).toBe(false);
    const later = createOnboardingStore(storage);
    later.getState().show();
    later.getState().addUse(100);
    expect(later.getState()).toMatchObject({ status: 'skipped', open: false, usedSeconds: 0 });
  });

  it('keeps the home city and the alerts answer on the device', () => {
    const storage = memoryStorage();
    const store = createOnboardingStore(storage);
    store.getState().setHomeCity(TOKYO);
    store.getState().setAlerts(true);
    store.getState().finish('done');
    expect(createOnboardingStore(storage).getState()).toMatchObject({
      status: 'done',
      homeCity: TOKYO,
      alerts: true,
    });
  });

  it('ignores what it cannot read', () => {
    const storage = memoryStorage({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify({
        status: 'weird',
        usedSeconds: -5,
        homeCity: { id: 1, label: 'x', lat: 200, lon: 0 },
        alerts: 'yes',
      }),
    });
    expect(createOnboardingStore(storage).getState()).toMatchObject({
      status: 'pending',
      usedSeconds: 0,
      homeCity: null,
      alerts: null,
    });
    expect(createOnboardingStore(null).getState().status).toBe('pending');
  });
});
