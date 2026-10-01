/**
 * Pure helpers for drawing the scrubber's track: where the hour ticks go and
 * how tall each histogram bar stands.
 */

const NICE_TICK_HOURS = [1, 2, 3, 6, 12];

/**
 * Hours back from now at which to label the track, about four intervals
 * across it: every 6 h for a day's window, every 12 h for two days. Oldest first.
 */
export function tickHours(historyHours: number): number[] {
  const raw = historyHours / 4;
  const largest = NICE_TICK_HOURS[NICE_TICK_HOURS.length - 1] ?? 1;
  const step = NICE_TICK_HOURS.find((hours) => hours >= raw) ?? Math.ceil(raw / largest) * largest;
  const ticks: number[] = [];
  for (let hours = step; hours < historyHours; hours += step) ticks.unshift(hours);
  return ticks;
}

/** A bucket with any story stands at least this tall, so a quiet hour still shows. */
const MIN_BAR = 0.06;

/**
 * Bar heights 0–1. Square-rooted, so a bucket with a quarter of the busiest
 * one's stories stands half as tall: quiet hours stay readable next to a spike.
 */
export function barHeights(counts: Uint16Array): Float32Array {
  let max = 0;
  for (const count of counts) max = Math.max(max, count);
  const heights = new Float32Array(counts.length);
  if (max === 0) return heights;
  counts.forEach((count, i) => {
    heights[i] = count === 0 ? 0 : Math.max(MIN_BAR, Math.sqrt(count / max));
  });
  return heights;
}
