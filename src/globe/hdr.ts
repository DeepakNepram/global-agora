/**
 * The luminance budget that makes selective bloom work.
 *
 * Bloom picks pixels by brightness alone, so "only city lights and pins bloom"
 * is a promise about output ranges, not about the bloom pass. The scene renders
 * to a half-float buffer and every layer stays inside its band:
 *
 *   day side    day * ndl * tint     <= 1      albedo <= 1, ndl <= 1, tint <= 1
 *   clouds      white * ndl * tint   <= 1
 *   atmosphere  premultiplied haze   <= ATMOSPHERE_MAX_LUMINANCE, blended over
 *   city lights night * gain         cores > BLOOM_THRESHOLD
 *   pins (1.5)  emissive             must exceed BLOOM_THRESHOLD to bloom
 *
 * Shaders interpolate these constants rather than restating them, so the budget
 * has one source of truth and src/globe/hdr.test.ts can check it.
 */

/** Bloom's luminance threshold. Just above white so a sunlit cloud never passes. */
export const BLOOM_THRESHOLD = 1.05;

/**
 * Night-map gain, keyed on the texel's own luminance.
 *
 * The night map is a dim blue-grey base (ocean ~0.012 linear, dark land ~0.015)
 * with city cores up to ~1.0 (measured on night-8192.webp: p99 luminance 0.06,
 * p99.9 0.64). A flat HDR gain lifts the base too and paints the night ocean
 * navy, so only bright texels get it:
 *
 *   key  = smoothstep(NIGHT_KEY_LOW, NIGHT_KEY_HIGH, luminance)
 *   gain = mix(NIGHT_BASE_GAIN, NIGHT_LIGHTS_GAIN, key)
 *
 * The base keeps 1.2's 0.9; cores reach 2.4, well over the bloom threshold.
 */
export const NIGHT_BASE_GAIN = 0.9;
export const NIGHT_LIGHTS_GAIN = 2.4;
export const NIGHT_KEY_LOW = 0.05;
export const NIGHT_KEY_HIGH = 0.5;

/** CPU mirror of the shader's night gain, for budget tests. */
export function nightGain(luminance: number): number {
  const t = Math.min(
    Math.max((luminance - NIGHT_KEY_LOW) / (NIGHT_KEY_HIGH - NIGHT_KEY_LOW), 0),
    1,
  );
  const key = t * t * (3 - 2 * t);
  return NIGHT_BASE_GAIN + (NIGHT_LIGHTS_GAIN - NIGHT_BASE_GAIN) * key;
}

/** Ceiling for atmosphere radiance, below the threshold with headroom. */
export const ATMOSPHERE_MAX_LUMINANCE = 0.9;

/** Formats a number as a GLSL float literal (GLSL rejects `2` where it wants `2.0`). */
export function glslFloat(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`not a finite GLSL float: ${value}`);
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}
