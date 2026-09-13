/**
 * The only place in src/ allowed to read the wall clock.
 *
 * Everything time-dependent (the sun, and later pin brightness) must render the
 * store's time, never "now", or the scrubber could not replay the past. Routing
 * every read through this one function makes that checkable: ESLint and
 * tests/clock.test.ts reject Date.now(), new Date() and performance.now()
 * anywhere else.
 */
export function wallClockNow(): number {
  return Date.now();
}
