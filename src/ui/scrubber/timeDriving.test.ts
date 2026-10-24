import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { timeStore } from '@/state';

import { createTimeDriving, timeStarted } from './timeDriving';

const HOUR_MS = 3_600_000;
const NOW_MS = Date.UTC(2026, 9, 24, 12);

describe('time driving', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    timeStore.getState().goLive();
    timeStore.getState().setMotion('still');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing, and asks for no frame, while the time is still', () => {
    timeStore.getState().setTime(NOW_MS - HOUR_MS);
    expect(createTimeDriving(24).tick(1 / 60, 'full')).toBe(false);
    expect(timeStore.getState().timeMs).toBe(NOW_MS - HOUR_MS);
  });

  it('plays the window through and lands live', () => {
    const driving = createTimeDriving(24);
    timeStore.getState().setMotion('playing');
    let frames = 0;
    let previous = -Infinity;
    while (driving.tick(1 / 60, 'full') && frames < 10_000) {
      frames++;
      expect(timeStore.getState().timeMs).toBeGreaterThanOrEqual(previous);
      previous = timeStore.getState().timeMs;
    }
    expect(frames).toBeGreaterThan(60);
    expect(timeStore.getState()).toMatchObject({ isLive: true, motion: 'still' });
  });

  it('eases a return to live, or lands it at once under reduced motion', () => {
    timeStore.getState().setTime(NOW_MS - 6 * HOUR_MS);
    timeStore.getState().returnToLive();
    const driving = createTimeDriving(24);
    expect(driving.tick(1 / 60, 'full')).toBe(true);
    expect(timeStore.getState().timeMs).toBeGreaterThan(NOW_MS - 6 * HOUR_MS);
    expect(timeStore.getState().isLive).toBe(false);

    timeStore.getState().setTime(NOW_MS - 6 * HOUR_MS);
    timeStore.getState().returnToLive();
    expect(createTimeDriving(24).tick(1 / 60, 'reduced')).toBe(false);
    expect(timeStore.getState().isLive).toBe(true);
  });

  it('notices Play and a return starting', () => {
    const still = { returning: false, motion: 'still' };
    expect(timeStarted({ returning: false, motion: 'playing' }, still)).toBe(true);
    expect(timeStarted({ returning: true, motion: 'still' }, still)).toBe(true);
    expect(timeStarted(still, still)).toBe(false);
  });
});
