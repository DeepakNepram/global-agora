/**
 * Seeded randomness for reproducible mock data.
 *
 * Math.random cannot be seeded, which would make benchmarks irreproducible and
 * the database seed different on every run. This module has no imports so the
 * seed script can load it directly under `node --experimental-strip-types`.
 */

/** mulberry32: a 32-bit state PRNG with good equidistribution for its size. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
