import { describe, expect, it } from 'vitest';

import { createNodeBuffer } from './nodeBuffer';
import {
  PLAY_RAMP_SECONDS,
  PLAY_SECONDS,
  RETURN_LAND_MS,
  fractionAt,
  histogramBuckets,
  historyRange,
  inMagnet,
  minutesAgo,
  playProgress,
  playSeconds,
  playStartMs,
  returnStep,
  storyHistogram,
  timeAt,
} from './timeline';

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const HOURS = 24;
const HOUR = 3_600_000;
const range = historyRange(NOW, HOURS);

describe('history range', () => {
  it('reaches back the configured hours, whatever they are', () => {
    expect(range).toEqual({ startMs: NOW - HOURS * HOUR, endMs: NOW });
    expect(historyRange(NOW, 72).startMs).toBe(NOW - 72 * HOUR);
  });

  it('maps instants to track fractions and back', () => {
    expect(fractionAt(range.startMs, range)).toBe(0);
    expect(fractionAt(NOW, range)).toBe(1);
    expect(fractionAt(NOW - 6 * HOUR, range)).toBeCloseTo(0.75, 12);
    for (const fraction of [0, 0.1, 0.5, 0.987, 1]) {
      expect(fractionAt(timeAt(fraction, range), range)).toBeCloseTo(fraction, 12);
    }
  });

  it('clamps instants outside the window to its ends', () => {
    expect(fractionAt(range.startMs - HOUR, range)).toBe(0);
    expect(fractionAt(NOW + HOUR, range)).toBe(1);
    expect(timeAt(-1, range)).toBe(range.startMs);
    expect(timeAt(2, range)).toBe(NOW);
  });
});

describe('the magnet', () => {
  it('covers the same pixels on a phone track and a desktop track', () => {
    // 32 px is 8.9 % of a 360 px track and 2.2 % of a 1440 px one.
    expect(inMagnet(1 - 31 / 360, 360, 32)).toBe(true);
    expect(inMagnet(1 - 33 / 360, 360, 32)).toBe(false);
    expect(inMagnet(1 - 31 / 1440, 1440, 32)).toBe(true);
    expect(inMagnet(1 - 33 / 1440, 1440, 32)).toBe(false);
    expect(inMagnet(1, 1440, 32)).toBe(true);
  });
});

describe('Play', () => {
  it('takes PLAY_SECONDS for the whole window and proportionally less from later on', () => {
    expect(playSeconds(0)).toBe(PLAY_SECONDS);
    expect(playSeconds(0.5)).toBe(PLAY_SECONDS / 2);
    expect(playSeconds(0.99)).toBe(2 * PLAY_RAMP_SECONDS);
  });

  it('starts from the oldest instant when live or nearly so, else from the held time', () => {
    expect(playStartMs(NOW, true, range)).toBe(range.startMs);
    expect(playStartMs(NOW - 10 * 60_000, false, range)).toBe(range.startMs);
    expect(playStartMs(NOW - 6 * HOUR, false, range)).toBeCloseTo(NOW - 6 * HOUR, 3);
  });

  it('eases in, holds speed, eases out, and lands exactly on 1', () => {
    const duration = PLAY_SECONDS;
    let previous = 0;
    let previousSpeed = 0;
    const speeds: number[] = [];
    for (let t = 0.01; t <= duration; t += 0.01) {
      const p = playProgress(t, duration);
      expect(p).toBeGreaterThanOrEqual(previous);
      speeds.push((p - previous) / 0.01);
      previousSpeed = (p - previous) / 0.01;
      previous = p;
    }
    expect(playProgress(0, duration)).toBe(0);
    expect(playProgress(duration, duration)).toBe(1);
    expect(playProgress(duration + 5, duration)).toBe(1);
    // Cruising speed is 1 / (D − r); the first and last steps are much slower.
    expect(speeds[Math.floor(speeds.length / 2)]).toBeCloseTo(
      1 / (duration - PLAY_RAMP_SECONDS),
      3,
    );
    expect(speeds[0]).toBeLessThan(0.01);
    expect(previousSpeed).toBeLessThan(0.01);
  });

  it('is continuous where the ramps meet the cruise', () => {
    const duration = 7;
    for (const t of [PLAY_RAMP_SECONDS, duration - PLAY_RAMP_SECONDS]) {
      expect(playProgress(t - 1e-9, duration)).toBeCloseTo(playProgress(t + 1e-9, duration), 6);
    }
  });

  it('shortens the ramps when the run is shorter than two of them', () => {
    expect(playProgress(0.5, 1, 1)).toBeCloseTo(0.5, 12);
    expect(playProgress(1, 1, 1)).toBe(1);
  });
});

describe('the return to live', () => {
  function landAt(hz: number, fromMs: number): number {
    let time = fromMs;
    for (let frame = 1; frame < 10_000; frame++) {
      const step = returnStep(time, NOW, 1 / hz);
      time = step.timeMs;
      if (step.landed) return frame / hz;
    }
    throw new Error('never landed');
  }

  it('lands in about half a second from an hour back and under a second from a day', () => {
    expect(landAt(60, NOW - HOUR)).toBeGreaterThan(0.4);
    expect(landAt(60, NOW - HOUR)).toBeLessThan(0.55);
    expect(landAt(60, NOW - HOURS * HOUR)).toBeLessThan(0.9);
  });

  it('takes the same time at 60 and 144 frames a second', () => {
    expect(Math.abs(landAt(60, NOW - 8 * HOUR) - landAt(144, NOW - 8 * HOUR))).toBeLessThan(1 / 60);
  });

  it('lands exactly on now once within the landing distance', () => {
    expect(returnStep(NOW - RETURN_LAND_MS / 2, NOW, 0)).toEqual({ timeMs: NOW, landed: true });
    expect(returnStep(NOW - HOUR, NOW, 0)).toEqual({ timeMs: NOW - HOUR, landed: false });
  });
});

describe('storyHistogram', () => {
  it('counts stories into equal slices of the window, oldest first', () => {
    const stories = createNodeBuffer(5);
    stories.count = 5;
    stories.epochSec = range.startMs / 1000;
    // Two in the first bucket, one in the middle, one exactly at now, one too old.
    stories.publishedSec.set([0, 60, 12 * 3600, HOURS * 3600, -60]);
    const buckets = histogramBuckets(HOURS);
    expect(buckets).toBe(96);
    const counts = storyHistogram(stories, range, buckets);
    expect(counts).toHaveLength(96);
    expect(counts[0]).toBe(2);
    expect(counts[48]).toBe(1);
    expect(counts[95]).toBe(1);
    expect(Array.from(counts).reduce((a, b) => a + b, 0)).toBe(4);
  });
});

describe('minutesAgo', () => {
  it('counts whole minutes and never goes negative', () => {
    expect(minutesAgo(NOW - 3 * HOUR - 28 * 60_000 - 5_000, NOW)).toBe(208);
    expect(minutesAgo(NOW + 60_000, NOW)).toBe(0);
  });
});
