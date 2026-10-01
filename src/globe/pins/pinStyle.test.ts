import { describe, expect, it } from 'vitest';

import { NEWS_CATEGORIES } from '@/core';

import { BLOOM_THRESHOLD } from '../hdr';
import { PIN_FRAG } from './pinFragment.glsl';
import { PIN_VERT } from './pinVertex.glsl';
import {
  CATEGORY_COLORS,
  COLOR_GAIN_NEW,
  COLOR_GAIN_OLD,
  FRESH_BIRTH_SECONDS,
  FRESH_FADE_SECONDS,
  FRESH_PEAK_SECONDS,
  FRESH_SCALE_BOOST,
  HALO_PEAK,
  HIDDEN_SCALE,
  PULSE_HZ_NEW,
  PULSE_HZ_OLD,
  SCALE_MAX,
  SCALE_MIN,
  birthFor,
  colorGainFor,
  freshnessFor,
  horizonVisibility,
  hotFor,
  lifeScaleFor,
  luminance,
  pulsePhaseFor,
  pulseRateFor,
  scaleForHeat,
} from './pinStyle';

/** postprocessing's BloomEffect uses luminanceSmoothing 0.25 (renderPipeline.ts). */
const FULL_BLOOM = BLOOM_THRESHOLD + 0.25;
const HOUR = 3600;

function hue(index: number): [number, number, number] {
  return [
    CATEGORY_COLORS[index * 3] ?? NaN,
    CATEGORY_COLORS[index * 3 + 1] ?? NaN,
    CATEGORY_COLORS[index * 3 + 2] ?? NaN,
  ];
}

describe("a pin's life", () => {
  it('is brightest for the first half hour, as the prompt asks', () => {
    expect(FRESH_PEAK_SECONDS).toBe(30 * 60);
    expect(freshnessFor(0)).toBe(1);
    expect(freshnessFor(FRESH_PEAK_SECONDS)).toBe(1);
    expect(freshnessFor(FRESH_PEAK_SECONDS + 1)).toBeLessThan(1);
  });

  it('then fades over the following hours, never below the old colour', () => {
    expect(freshnessFor(FRESH_PEAK_SECONDS + FRESH_FADE_SECONDS)).toBeCloseTo(Math.exp(-1), 12);
    expect(freshnessFor(12 * HOUR)).toBeLessThan(0.05);
    expect(colorGainFor(freshnessFor(20 * HOUR))).toBeCloseTo(COLOR_GAIN_OLD, 2);
    let previous = 1;
    for (let age = 0; age < 30 * HOUR; age += 600) {
      expect(freshnessFor(age)).toBeLessThanOrEqual(previous);
      previous = freshnessFor(age);
    }
  });

  it('is nothing before publication', () => {
    expect(freshnessFor(-1)).toBe(0);
    expect(birthFor(-1)).toBe(0);
    expect(birthFor(0)).toBe(0);
  });

  it('grows in with a pop over the first minutes and then holds its size', () => {
    expect(birthFor(FRESH_BIRTH_SECONDS)).toBe(1);
    expect(lifeScaleFor(0)).toBeCloseTo(HIDDEN_SCALE * (1 + FRESH_SCALE_BOOST), 12);
    const peak = Math.max(
      ...Array.from({ length: 50 }, (_, i) => lifeScaleFor((i / 49) * FRESH_BIRTH_SECONDS)),
    );
    expect(peak).toBeGreaterThan(1.1 * (1 + FRESH_SCALE_BOOST));
    expect(lifeScaleFor(FRESH_BIRTH_SECONDS)).toBeCloseTo(1 + FRESH_SCALE_BOOST, 12);
    expect(lifeScaleFor(20 * HOUR)).toBeCloseTo(1, 2);
  });

  it('makes newer stories pulse faster', () => {
    expect(pulseRateFor(1)).toBeCloseTo(2 * Math.PI * PULSE_HZ_NEW, 12);
    expect(pulseRateFor(0)).toBeCloseTo(2 * Math.PI * PULSE_HZ_OLD, 12);
    expect(pulseRateFor(freshnessFor(HOUR))).toBeGreaterThan(pulseRateFor(freshnessFor(5 * HOUR)));
  });
});

describe('brightness budget', () => {
  /** Luminance at the dot's centre, as the fragment shader builds it. */
  const centre = (category: number, freshness: number): number =>
    luminance(...hue(category)) * colorGainFor(freshness) + hotFor(freshness);

  it('keeps every hue at full intensity without leaving the 0..1 range', () => {
    NEWS_CATEGORIES.forEach((_, i) => {
      expect(Math.max(...hue(i))).toBeCloseTo(1, 6);
      expect(Math.min(...hue(i))).toBeGreaterThanOrEqual(0);
    });
  });

  it('blooms fully at the centre of a fresh story in every category', () => {
    NEWS_CATEGORIES.forEach((_, i) => {
      expect(centre(i, 1)).toBeGreaterThan(FULL_BLOOM);
    });
  });

  it('never blooms from colour alone, so older stories stay below the threshold', () => {
    NEWS_CATEGORIES.forEach((_, i) => {
      expect(luminance(...hue(i)) * COLOR_GAIN_NEW).toBeLessThan(BLOOM_THRESHOLD);
      expect(centre(i, freshnessFor(3 * HOUR))).toBeLessThan(BLOOM_THRESHOLD);
    });
    // The white-hot core lasts about 2.9 hours.
    expect(hotFor(freshnessFor(3 * HOUR))).toBe(0);
    expect(hotFor(freshnessFor(2.75 * HOUR))).toBeGreaterThan(0);
  });

  it('keeps a single halo below the bloom threshold', () => {
    expect(HALO_PEAK * COLOR_GAIN_NEW).toBeLessThan(BLOOM_THRESHOLD);
  });
});

describe('scale and phase', () => {
  it('maps heat 0..255 onto SCALE_MIN..SCALE_MAX', () => {
    expect(scaleForHeat(0)).toBe(SCALE_MIN);
    expect(scaleForHeat(255)).toBeCloseTo(SCALE_MAX, 12);
    expect(scaleForHeat(64)).toBeGreaterThan((SCALE_MIN + SCALE_MAX) / 2);
  });

  it('spreads stories published a second apart around the circle', () => {
    const t = 1_758_000_000;
    const gap = Math.abs(pulsePhaseFor(t + 1) - pulsePhaseFor(t));
    expect(Math.min(gap, 2 * Math.PI - gap)).toBeGreaterThan(1);
    expect(pulsePhaseFor(t)).toBeGreaterThanOrEqual(0);
    expect(pulsePhaseFor(t)).toBeLessThan(2 * Math.PI);
  });
});

describe('horizonVisibility', () => {
  // Camera 3 radii above the surface on +Z: the horizon is at dot = 1/4.
  const camera = [0, 0, 4] as const;
  const at = (angleRad: number): number =>
    horizonVisibility(Math.sin(angleRad), 0, Math.cos(angleRad), ...camera);
  const horizonAngle = Math.acos(1 / 4);

  it('shows pins facing the camera and hides the far side', () => {
    expect(at(0)).toBe(1);
    expect(at(Math.PI)).toBe(0);
    expect(at(Math.PI / 2)).toBe(0);
  });

  it('is 0 at the prompt inequality and fades in over a band inside it', () => {
    expect(at(horizonAngle)).toBeLessThan(1e-12);
    expect(at(horizonAngle + 1e-3)).toBe(0);
    const inBand = at(horizonAngle - 0.02);
    expect(inBand).toBeGreaterThan(0);
    expect(inBand).toBeLessThan(1);
    // Band edge: dot = h + 0.1 (1 - h) = 0.325.
    expect(at(Math.acos(0.325) - 1e-6)).toBeCloseTo(1, 5);
  });

  it('never shows a pin the prompt rule would cull', () => {
    for (let i = 0; i < 2000; i++) {
      const theta = Math.acos(2 * ((i * 0.618034) % 1) - 1);
      const phi = i * 2.399963;
      const p = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      const [px = 0, py = 0, pz = 0] = p;
      const cam = [1.2, 0.4, -0.5] as const;
      const d = Math.hypot(...cam);
      const culled = (px * cam[0] + py * cam[1] + pz * cam[2]) / d < 1 / d;
      if (culled) expect(horizonVisibility(px, py, pz, ...cam)).toBe(0);
    }
  });

  it('scales the band with the visible cap, so it stays thin at low altitude', () => {
    // 50 km up: the cap is only ~7° wide, so a fixed band would hide everything.
    const low = [0, 0, 1 + 50 / 6371] as const;
    const edgeAngle = Math.acos(1 / low[2]);
    expect(horizonVisibility(Math.sin(edgeAngle * 0.5), 0, Math.cos(edgeAngle * 0.5), ...low)).toBe(
      1,
    );
  });
});

describe('pin shaders', () => {
  it('ages every pin against the displayed instant, so a scrub moves one uniform', () => {
    expect(PIN_VERT).toContain('uniform float uNow;');
    expect(PIN_VERT).toContain('float age = uNow - aPulse.z;');
    expect(PIN_VERT).toContain('float birth = smoothstep(0.0, FRESH_BIRTH, age);');
    expect(PIN_VERT).toContain(
      'float freshness = step(0.0, age) * (age <= FRESH_PEAK ? 1.0 : exp(-(age - FRESH_PEAK) / FRESH_FADE));',
    );
    expect(PIN_VERT).toMatch(/const float FRESH_PEAK = 1800\.0;/);
  });

  it('runs the bloom spring and lands it exactly once settled', () => {
    expect(PIN_VERT).toMatch(/const float OMEGA = 33\.0;/);
    expect(PIN_VERT).toContain(
      'float u = clamp(aSpring.w + (delta + (aSpring.y + OMEGA * delta) * tau) * exp(-OMEGA * tau), 0.0, 1.0);',
    );
    expect(PIN_VERT).toContain('if (tau >= SETTLE) u = aSpring.w;');
  });

  it('has every TypeScript constant interpolated in the vertex shader', () => {
    expect(PIN_VERT).not.toMatch(/=\s*(undefined|NaN);/);
    expect(PIN_VERT).toMatch(/const float PULSE_AMPLITUDE = 0\.15;/);
    expect(PIN_VERT).toMatch(/const float GLOBE_RADIUS = 1\.0;/);
  });

  it('implements the prompt pulse and horizon expressions', () => {
    // Pins pulse; orbs, pins mid-way to becoming one, and filtered pins hold still in proportion.
    expect(PIN_VERT).toContain(
      'float pulse = 1.0 + PULSE_AMPLITUDE * sin(uTime * aPulse.y + aPulse.x) * freshness * uPulse * (1.0 - orbness) * (1.0 - dimmed);',
    );
    expect(PIN_VERT).toContain('float horizon = GLOBE_RADIUS / cameraDistance;');
    expect(PIN_VERT).toContain(
      'smoothstep(horizon, horizon + HORIZON_FADE * (1.0 - horizon), facing)',
    );
  });

  it('dims and shrinks what the filters leave out, never the open story', () => {
    expect(PIN_VERT).toMatch(/const float FILTERED_ALPHA = 0\.3;/);
    expect(PIN_VERT).toMatch(/const float FILTERED_SCALE = 0\.6;/);
    expect(PIN_VERT).toContain('return within < 0.0 ? 1.0 : step(age, within);');
    expect(PIN_VERT).toContain(
      'float dimmed = (1.0 - mix(endMatch(aInner.w, age), endMatch(aOuter.w, age), u)) * (1.0 - vSelected);',
    );
    expect(PIN_VERT).toContain('visibility *= mix(1.0, FILTERED_ALPHA, dimmed);');
    expect(PIN_VERT).toContain('vHalfSizePx *= mix(1.0, FILTERED_SCALE, dimmed);');
  });

  it('outputs premultiplied colour with the dot and shadow in alpha', () => {
    expect(PIN_FRAG).toContain('gl_FragColor = vec4(color, coverage) * vAlpha;');
    // Halos weighted by the view angle to the ground, so the limb does not ring.
    expect(PIN_VERT).toContain(
      'vHaloWeight = max(dot(centre, normalize(uCameraLocal - centre)), 0.0) * (1.0 - dimmed);',
    );
    expect(PIN_FRAG).toContain('float halo = HALO_PEAK * vHaloWeight * fall * fall;');
    // Comments stripped: the shader explains why it avoids the keyword.
    expect(PIN_FRAG.replace(/\/\/.*$/gm, '')).not.toMatch(/\bdiscard\b/);
  });
});
