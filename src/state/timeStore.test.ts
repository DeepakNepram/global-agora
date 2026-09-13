import { describe, expect, it } from 'vitest';

import { createTimeStore } from './timeStore';

function fakeClock(start: number): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe('time store', () => {
  it('starts live at the injected clock time', () => {
    const clock = fakeClock(1_000);
    const store = createTimeStore(clock.now);
    expect(store.getState()).toMatchObject({ timeMs: 1_000, isLive: true });
  });

  it('follows the clock on syncLive while live', () => {
    const clock = fakeClock(1_000);
    const store = createTimeStore(clock.now);
    clock.advance(30_000);
    store.getState().syncLive();
    expect(store.getState().timeMs).toBe(31_000);
  });

  it('setTime leaves live mode and ignores later syncs', () => {
    const clock = fakeClock(1_000);
    const store = createTimeStore(clock.now);
    store.getState().setTime(500);
    clock.advance(30_000);
    store.getState().syncLive();
    expect(store.getState()).toMatchObject({ timeMs: 500, isLive: false });
  });

  it('goLive jumps back to now', () => {
    const clock = fakeClock(1_000);
    const store = createTimeStore(clock.now);
    store.getState().setTime(500);
    clock.advance(9_000);
    store.getState().goLive();
    expect(store.getState()).toMatchObject({ timeMs: 10_000, isLive: true });
  });

  it('rejects non-finite times', () => {
    const store = createTimeStore(() => 1_000);
    store.getState().setTime(Number.NaN);
    expect(store.getState()).toMatchObject({ timeMs: 1_000, isLive: true });
  });

  it('notifies subscribers only when state changes', () => {
    const clock = fakeClock(1_000);
    const store = createTimeStore(clock.now);
    const seen: number[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(state.timeMs));

    store.getState().setTime(2_000);
    store.getState().syncLive(); // scrubbed: must not emit
    unsubscribe();

    expect(seen).toEqual([2_000]);
  });
});
