import { describe, expect, it } from 'vitest';

import { NEWS_CATEGORIES } from '@/core';

import { BLOOM_THRESHOLD } from '../hdr';
import { PIN_FRAG, PIN_VERT } from './pins.glsl';
import {
  CATEGORY_COLORS,
  COLOR_GAIN_NEW,
  HALO_PEAK,
  PULSE_HZ_NEW,
  PULSE_HZ_OLD,
  RECENCY_TIME_CONSTANT_SECONDS,
  SCALE_MAX,
  SCALE_MIN,
  colorGainFor,
  horizonVisibility,
  hotFor,
  luminance,
  pulsePhaseFor,
  pulseRateFor,
  recencyFor,
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

describe('recency', () => {
  it('decays exponentially from 1 at publication', () => {
    expect(recencyFor(0)).toBe(1);
    expect(recencyFor(RECENCY_TIME_CONSTANT_SECONDS)).toBeCloseTo(Math.exp(-1), 12);
    expect(recencyFor(24 * HOUR)).toBeCloseTo(Math.exp(-4), 12);
  });

  it('is 0 for a story not yet published', () => {
    expect(recencyFor(-1)).toBe(0);
  });

  it('makes newer stories pulse faster', () => {
    expect(pulseRateFor(1)).toBeCloseTo(2 * Math.PI * PULSE_HZ_NEW, 12);
    expect(pulseRateFor(0)).toBeCloseTo(2 * Math.PI * PULSE_HZ_OLD, 12);
    expect(pulseRateFor(recencyFor(HOUR))).toBeGreaterThan(pulseRateFor(recencyFor(5 * HOUR)));
  });
});

describe('brightness budget', () => {
  /** Luminance at the dot's centre, as the fragment shader builds it. */
  const centre = (category: number, recency: number): number =>
    luminance(...hue(category)) * colorGainFor(recency) + hotFor(recency);

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
      expect(centre(i, recencyFor(5 * HOUR))).toBeLessThan(BLOOM_THRESHOLD);
    });
    expect(hotFor(recencyFor(5 * HOUR))).toBe(0);
    expect(hotFor(recencyFor(4.5 * HOUR))).toBeGreaterThan(0);
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
  it('has every TypeScript constant interpolated in the vertex shader', () => {
    expect(PIN_VERT).not.toMatch(/=\s*(undefined|NaN);/);
    expect(PIN_VERT).toMatch(/const float PULSE_AMPLITUDE = 0\.15;/);
    expect(PIN_VERT).toMatch(/const float GLOBE_RADIUS = 1\.0;/);
  });

  it('implements the prompt pulse and horizon expressions', () => {
    expect(PIN_VERT).toContain(
      'float pulse = 1.0 + PULSE_AMPLITUDE * sin(uTime * aRate + aPhase) * aRecency * uPulse;',
    );
    expect(PIN_VERT).toContain('float horizon = GLOBE_RADIUS / cameraDistance;');
    expect(PIN_VERT).toContain(
      'smoothstep(horizon, horizon + HORIZON_FADE * (1.0 - horizon), facing)',
    );
  });

  it('outputs premultiplied colour with the dot and shadow in alpha', () => {
    expect(PIN_FRAG).toContain('gl_FragColor = vec4(color, coverage) * vAlpha;');
    // Halos weighted by the view angle to the ground, so the limb does not ring.
    expect(PIN_VERT).toContain(
      'vHaloWeight = max(dot(normalize(aCenter), normalize(uCameraLocal - aCenter)), 0.0);',
    );
    expect(PIN_FRAG).toContain('float halo = HALO_PEAK * vHaloWeight * fall * fall;');
    // Comments stripped: the shader explains why it avoids the keyword.
    expect(PIN_FRAG.replace(/\/\/.*$/gm, '')).not.toMatch(/\bdiscard\b/);
  });
});
