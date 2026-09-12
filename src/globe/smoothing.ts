/**
 * Frame-rate-independent smoothing.
 *
 * CLAUDE.md hard constraint #3. The naive `lerp(x, target, 0.1)` is wrong because
 * its speed depends on frame rate — the same camera drift is twice as fast at
 * 120fps as at 60fps. The exponential form converges at a fixed rate in seconds:
 *
 *   x += (target - x) * (1 - e^(-k * dt))
 *
 * `stiffness` (k) is in units of 1/second: k = 10 closes ~63% of the gap in 100ms.
 */
export function smoothTowards(
  current: number,
  target: number,
  stiffness: number,
  dt: number,
): number {
  return current + (target - current) * (1 - Math.exp(-stiffness * dt));
}
