import { describe, expect, it } from 'vitest';

import {
  ATMOSPHERE_MAX_LUMINANCE,
  BLOOM_THRESHOLD,
  NIGHT_BASE_GAIN,
  NIGHT_KEY_HIGH,
  NIGHT_KEY_LOW,
  NIGHT_LIGHTS_GAIN,
  glslFloat,
  nightGain,
} from './hdr';
import { EARTH_FRAG } from './shaders/earth.glsl';

/** Linear luminances measured on night-8192.webp (see hdr.ts). */
const OCEAN = 0.012;
const CITY_FRINGE = 0.06; // p99
const CITY_CORE = 0.64; // p99.9

describe('luminance budget', () => {
  it('keeps a fully lit white cloud out of bloom', () => {
    // Day-side albedo, Lambert and tint are all <= 1, so white is the ceiling.
    expect(BLOOM_THRESHOLD).toBeGreaterThan(1);
  });

  it('puts city-light cores into bloom', () => {
    expect(CITY_CORE * nightGain(CITY_CORE)).toBeGreaterThan(BLOOM_THRESHOLD);
    expect(1.0 * nightGain(1.0)).toBeGreaterThan(BLOOM_THRESHOLD * 2);
  });

  it('keeps the night base and city fringes out of bloom', () => {
    expect(CITY_FRINGE * nightGain(CITY_FRINGE)).toBeLessThan(BLOOM_THRESHOLD);
    expect(nightGain(OCEAN)).toBe(NIGHT_BASE_GAIN);
  });

  it('keeps the atmosphere under the threshold with headroom', () => {
    expect(ATMOSPHERE_MAX_LUMINANCE).toBeLessThan(BLOOM_THRESHOLD);
  });

  it('is the set of values the earth shader actually uses', () => {
    for (const [name, value] of Object.entries({
      NIGHT_BASE_GAIN,
      NIGHT_LIGHTS_GAIN,
      NIGHT_KEY_LOW,
      NIGHT_KEY_HIGH,
    })) {
      expect(EARTH_FRAG).toContain(`const float ${name} = ${glslFloat(value)};`);
    }
    expect(EARTH_FRAG).toContain('smoothstep(NIGHT_KEY_LOW, NIGHT_KEY_HIGH, nightLuminance)');
  });
});

describe('nightGain', () => {
  it('rises monotonically from the base gain to the lights gain', () => {
    expect(nightGain(0)).toBe(NIGHT_BASE_GAIN);
    expect(nightGain(NIGHT_KEY_HIGH)).toBe(NIGHT_LIGHTS_GAIN);
    let previous = 0;
    for (let l = 0; l <= 1; l += 0.01) {
      expect(nightGain(l)).toBeGreaterThanOrEqual(previous);
      previous = nightGain(l);
    }
  });
});

describe('glslFloat', () => {
  it('always writes a decimal point', () => {
    expect(glslFloat(2)).toBe('2.0');
    expect(glslFloat(0.9)).toBe('0.9');
    expect(glslFloat(-1)).toBe('-1.0');
  });

  it('rejects values GLSL cannot represent', () => {
    expect(() => glslFloat(Number.NaN)).toThrow(RangeError);
    expect(() => glslFloat(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
