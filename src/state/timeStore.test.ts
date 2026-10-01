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

describe('time motion and the return to live', () => {
  it('starts still and not returning', () => {
    const store = createTimeStore(() => 1_000);
    expect(store.getState()).toMatchObject({ motion: 'still', returning: false });
  });

  it('returnToLive asks for an eased return and goLive ends it', () => {
    const clock = fakeClock(10_000);
    const store = createTimeStore(clock.now);
    store.getState().setTime(2_000);
    store.getState().returnToLive();
    expect(store.getState()).toMatchObject({ timeMs: 2_000, isLive: false, returning: true });

    // The driver's frames keep the return going.
    store.getState().stepTime(6_000);
    expect(store.getState()).toMatchObject({ timeMs: 6_000, returning: true });

    clock.advance(500);
    store.getState().goLive();
    expect(store.getState()).toMatchObject({ timeMs: 10_500, isLive: true, returning: false });
  });

  it('does not start a return when already live', () => {
    const store = createTimeStore(() => 1_000);
    store.getState().returnToLive();
    expect(store.getState().returning).toBe(false);
  });

  it('a drag leaving the magnet cancels the return', () => {
    const store = createTimeStore(() => 10_000);
    store.getState().setMotion('dragging');
    store.getState().setTime(9_000);
    store.getState().returnToLive();
    expect(store.getState()).toMatchObject({ motion: 'dragging', returning: true });
    store.getState().setTime(4_000);
    expect(store.getState()).toMatchObject({ timeMs: 4_000, returning: false });
  });

  it('Play replaces a return, and a return stops Play', () => {
    const store = createTimeStore(() => 10_000);
    store.getState().setTime(2_000);
    store.getState().returnToLive();
    store.getState().setMotion('playing');
    expect(store.getState()).toMatchObject({ motion: 'playing', returning: false });
    store.getState().returnToLive();
    expect(store.getState()).toMatchObject({ motion: 'still', returning: true });
  });

  it('stepTime leaves live mode without changing the motion', () => {
    const store = createTimeStore(() => 10_000);
    store.getState().setMotion('playing');
    store.getState().stepTime(3_000);
    expect(store.getState()).toMatchObject({ timeMs: 3_000, isLive: false, motion: 'playing' });
  });
});
