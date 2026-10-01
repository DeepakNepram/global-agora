/**
 * The time scrubber's maths: where an instant sits on the track, the magnet
 * at "now", the Play curve and the eased return to live. Pure functions over
 * epoch milliseconds, so the UI, the frame driver and tests share one model.
 *
 * The scrubber reaches back AppConfig.historyWindowHours, a tier boundary;
 * nothing here assumes how long that is.
 */

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

/** One full window of Play, whatever its length: about the prompt's 20 seconds. */
export const PLAY_SECONDS = 20;

/** Play speeds up and slows down over this long, so it neither jerks off nor slams into live. */
export const PLAY_RAMP_SECONDS = 1;

/** Play starts from the oldest instant when the time is this close to live (a fraction of the window). */
export const PLAY_FROM_START_FRACTION = 0.98;

/**
 * The return to live, k in x += (target − x)(1 − e^(−k·dt)) (CLAUDE.md's
 * smoothing): from an hour back it lands in about 0.5 s, from a day in 0.8 s.
 */
export const RETURN_RATE_PER_SECOND = 10;

/** Close enough to land: the sun moves 0.125° in 30 s, inside the terminator's soft band. */
export const RETURN_LAND_MS = 30_000;

/** The news-volume histogram's bucket. */
export const HISTOGRAM_BUCKET_MINUTES = 15;

/** The scrubber's reach: the last `hours` up to `endMs`, normally the wall clock. */
export interface TimeRange {
  readonly startMs: number;
  readonly endMs: number;
}

export function historyRange(endMs: number, hours: number): TimeRange {
  return { startMs: endMs - hours * MS_PER_HOUR, endMs };
}

/** Where `timeMs` sits on the track, 0 the oldest instant and 1 now, clamped. */
export function fractionAt(timeMs: number, range: TimeRange): number {
  const span = range.endMs - range.startMs;
  if (!(span > 0)) return 1;
  return Math.min(Math.max((timeMs - range.startMs) / span, 0), 1);
}

export function timeAt(fraction: number, range: TimeRange): number {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return range.startMs + (range.endMs - range.startMs) * clamped;
}

/** True within `magnetPx` CSS pixels of the track's live end, where the thumb snaps to now. */
export function inMagnet(fraction: number, trackPx: number, magnetPx: number): boolean {
  return (1 - fraction) * Math.max(trackPx, 0) <= magnetPx;
}

/** Seconds a Play from `fromFraction` lasts: PLAY_SECONDS for the whole window, never under two ramps. */
export function playSeconds(fromFraction: number): number {
  const remaining = 1 - Math.min(Math.max(fromFraction, 0), 1);
  return Math.max(PLAY_SECONDS * remaining, 2 * PLAY_RAMP_SECONDS);
}

/** Where Play starts: the held instant, or the oldest one when the time is (nearly) live. */
export function playStartMs(timeMs: number, isLive: boolean, range: TimeRange): number {
  const fraction = fractionAt(timeMs, range);
  return isLive || fraction >= PLAY_FROM_START_FRACTION ? range.startMs : timeAt(fraction, range);
}

/**
 * Progress through a Play of `durationSec` after `elapsedSec`, 0 to 1, along a
 * trapezoidal speed profile: speed ramps up over r = min(ramp, D/2), holds
 * v = 1 / (D − r), and ramps down over the last r, so
 *   t < r:          p = v t² / 2r
 *   r ≤ t ≤ D − r:  p = v r / 2 + v (t − r)
 *   t > D − r:      p = 1 − v (D − t)² / 2r
 */
export function playProgress(
  elapsedSec: number,
  durationSec: number,
  rampSec = PLAY_RAMP_SECONDS,
): number {
  if (!(durationSec > 0) || elapsedSec >= durationSec) return 1;
  if (!(elapsedSec > 0)) return 0;
  const r = Math.min(rampSec, durationSec / 2);
  const v = 1 / (durationSec - r);
  if (elapsedSec < r) return (v * elapsedSec * elapsedSec) / (2 * r);
  if (elapsedSec <= durationSec - r) return (v * r) / 2 + v * (elapsedSec - r);
  const left = durationSec - elapsedSec;
  return 1 - (v * left * left) / (2 * r);
}

export interface ReturnStep {
  readonly timeMs: number;
  /** Within RETURN_LAND_MS of now: go live. */
  readonly landed: boolean;
}

/** One frame of the eased return to live, frame-rate independent. */
export function returnStep(timeMs: number, nowMs: number, dtSeconds: number): ReturnStep {
  const next =
    timeMs + (nowMs - timeMs) * (1 - Math.exp(-RETURN_RATE_PER_SECOND * Math.max(dtSeconds, 0)));
  return Math.abs(nowMs - next) <= RETURN_LAND_MS
    ? { timeMs: nowMs, landed: true }
    : { timeMs: next, landed: false };
}

/** The story columns the histogram reads; a NodeBuffer is one. */
export interface StoryTimes {
  readonly count: number;
  readonly epochSec: number;
  readonly publishedSec: Int32Array;
}

/** HISTOGRAM_BUCKET_MINUTES buckets across `hours`, at least one. */
export function histogramBuckets(hours: number): number {
  return Math.max(1, Math.round((hours * 60) / HISTOGRAM_BUCKET_MINUTES));
}

/**
 * Stories published in each of `buckets` equal slices of `range`, oldest
 * first. Anything outside the range is left out; a story published exactly at
 * the range's end counts in the last bucket.
 */
export function storyHistogram(
  stories: StoryTimes,
  range: TimeRange,
  buckets: number,
): Uint16Array {
  const counts = new Uint16Array(Math.max(1, Math.floor(buckets)));
  const span = range.endMs - range.startMs;
  if (!(span > 0)) return counts;
  for (let row = 0; row < stories.count; row++) {
    const atMs = (stories.epochSec + (stories.publishedSec[row] ?? 0)) * 1000;
    if (atMs < range.startMs || atMs > range.endMs) continue;
    const bucket = Math.min(
      Math.floor(((atMs - range.startMs) / span) * counts.length),
      counts.length - 1,
    );
    counts[bucket] = Math.min((counts[bucket] ?? 0) + 1, 0xffff);
  }
  return counts;
}

/** Whole minutes from `timeMs` back to `nowMs`, never negative. */
export function minutesAgo(timeMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - timeMs) / MS_PER_MINUTE));
}
