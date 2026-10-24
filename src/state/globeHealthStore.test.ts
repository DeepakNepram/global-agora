import { describe, expect, it } from 'vitest';

import { createGlobeHealthStore } from './globeHealthStore';

describe('globeHealthStore', () => {
  it('restores a lost context with a new canvas', () => {
    const store = createGlobeHealthStore();
    store.getState().contextLost(1000);
    expect(store.getState()).toMatchObject({ restoring: true, generation: 0, fallback: null });
    store.getState().remount();
    expect(store.getState()).toMatchObject({ restoring: false, generation: 1 });
    // A second "restored" for the same loss makes no second canvas.
    store.getState().remount();
    expect(store.getState().generation).toBe(1);
  });

  it('falls back to the flat map after repeated losses, or a crash', () => {
    const lost = createGlobeHealthStore();
    for (const at of [1000, 2000, 3000]) {
      lost.getState().contextLost(at);
      lost.getState().remount();
    }
    expect(lost.getState()).toMatchObject({ fallback: 'lost', restoring: false });

    const crashed = createGlobeHealthStore();
    crashed.getState().crashed();
    expect(crashed.getState().fallback).toBe('crashed');
  });
});
