import { Color } from 'three';

import { GLOBE_RADIUS, NEWS_CATEGORIES } from '@/core';

/**
 * How a story becomes a pin: colour from category, brightness and pulse from
 * recency, size from heat. Shaders interpolate these constants, and the CPU
 * mirrors below exist so tests can check the maths the GPU runs.
 */

const TAU = Math.PI * 2;

/** Recency = exp(-age / τ): 1 when published, 0.37 after τ, 0.02 after 4τ. */
export const RECENCY_TIME_CONSTANT_SECONDS = 6 * 3600;

/** The prompt's pulse: scale = base · (1 + PULSE_AMPLITUDE · sin(t·rate + phase) · recency). */
export const PULSE_AMPLITUDE = 0.15;
/** Pulse frequency of the oldest and the newest story, in Hz. */
export const PULSE_HZ_OLD = 0.25;
export const PULSE_HZ_NEW = 1.0;

/**
 * Colour brightness of the oldest and newest story. The hue itself never goes
 * past 1 in any channel, so it tone-maps as the colour it is instead of a
 * pastel, and on its own it can never reach the bloom threshold.
 */
export const COLOR_GAIN_OLD = 0.55;
export const COLOR_GAIN_NEW = 1.0;

/**
 * Fresh stories get a white-hot centre on top of their colour, and that is what
 * blooms: 0 until recency passes HOT_RECENCY_START (about 4.8 hours old), then
 * rising to HOT_CORE_MAX at publication. The colour stays in the dot's rim and
 * the halo, the way a bright light photographs.
 */
export const HOT_RECENCY_START = 0.45;
export const HOT_CORE_MAX = 1.5;

/** Halo brightness at the dot's edge, relative to the colour. At most 0.3 < threshold. */
export const HALO_PEAK = 0.3;

/**
 * A soft dark ring behind each dot, as a fraction of what lies beneath. Emitted
 * light alone has no contrast against sunlit desert or cloud; the ring gives the
 * dot an edge there and is invisible against the night side.
 */
export const SHADOW_OPACITY = 0.4;
/** Outer edge of the shadow ring, as a fraction of the quad half-size. */
export const SHADOW_RADIUS = 0.55;

/** Heat 0 draws at SCALE_MIN, heat 255 at SCALE_MAX; sqrt so mid heat is visibly bigger. */
export const SCALE_MIN = 0.75;
export const SCALE_MAX = 1.3;

/** Quad half-size at scale 1, in CSS pixels. Pins keep this size on screen at every altitude. */
export const PIN_HALF_SIZE_CSS_PX = 9;
/** Dot radius as a fraction of the quad half-size (2.7 CSS px at scale 1). */
export const CORE_RADIUS = 0.3;

/** Pins fade out over this fraction of the visible cap's depth before the horizon. */
export const HORIZON_FADE_FRACTION = 0.1;

/**
 * Pulse clock limit. The shader evaluates sin(uTime·rate + phase) in float32,
 * whose step at time t is t / 2²³: 0.07 ms at 600 s, 0.5 mrad of pulse at the
 * fastest rate. Left to run for a day the step is 10 ms (65 mrad), which
 * shimmers, so the clock is rebased before that (see rebasePulseClock).
 */
export const PULSE_CLOCK_REBASE_SECONDS = 600;

/**
 * Category hues in sRGB, one per NEWS_CATEGORIES entry. A starting palette, to
 * tune by eye; hue alone is not accessible, so Phase 5 adds shape or label.
 */
export const CATEGORY_HUES: Readonly<Record<(typeof NEWS_CATEGORIES)[number], number>> = {
  // Saturated mid-tones, scaled to full intensity below. A light pastel would
  // read as white once it glows.
  world: 0x94a3b8,
  conflict: 0xef4444,
  politics: 0x8b5cf6,
  business: 0xf59e0b,
  science: 0x06b6d4,
  climate: 0x22c55e,
  tech: 0xec4899,
  health: 0x3b82f6,
};

/** Rec. 709 luma, the same weights the bloom pass keys on. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Linear RGB per category, scaled so the brightest channel is 1, flattened
 * (3 per category). Scaling to equal luminance instead pushed red and blue to
 * 4× in one channel, which ACES flattened into pastels. Blooming does not
 * depend on hue: the white-hot centre (hotFor) is what crosses the threshold.
 */
export const CATEGORY_COLORS: Float32Array = (() => {
  const colors = new Float32Array(NEWS_CATEGORIES.length * 3);
  const color = new Color();
  NEWS_CATEGORIES.forEach((category, i) => {
    // Color.setHex treats hex as sRGB and stores linear (three's ColorManagement).
    color.setHex(CATEGORY_HUES[category]);
    const scale = 1 / Math.max(color.r, color.g, color.b);
    colors[i * 3] = color.r * scale;
    colors[i * 3 + 1] = color.g * scale;
    colors[i * 3 + 2] = color.b * scale;
  });
  return colors;
})();

export function recencyFor(ageSeconds: number): number {
  return ageSeconds < 0 ? 0 : Math.exp(-ageSeconds / RECENCY_TIME_CONSTANT_SECONDS);
}

/** Angular pulse rate in rad/s. */
export function pulseRateFor(recency: number): number {
  return TAU * (PULSE_HZ_OLD + (PULSE_HZ_NEW - PULSE_HZ_OLD) * recency);
}

export function colorGainFor(recency: number): number {
  return COLOR_GAIN_OLD + (COLOR_GAIN_NEW - COLOR_GAIN_OLD) * recency;
}

/** White added at the dot's centre: 0 for older stories, HOT_CORE_MAX when brand new. */
export function hotFor(recency: number): number {
  const t = (recency - HOT_RECENCY_START) / (1 - HOT_RECENCY_START);
  return HOT_CORE_MAX * Math.min(Math.max(t, 0), 1);
}

export function scaleForHeat(heat: number): number {
  return SCALE_MIN + (SCALE_MAX - SCALE_MIN) * Math.sqrt(Math.min(Math.max(heat, 0), 255) / 255);
}

/**
 * Start phase from the absolute publish time: fract(t · (√5 - 1) / 2) spreads
 * consecutive integers evenly around the circle (Weyl sequence), so stories
 * published seconds apart do not pulse in step.
 */
export function pulsePhaseFor(publishedEpochSeconds: number): number {
  const spread = publishedEpochSeconds * 0.6180339887498949;
  return TAU * (spread - Math.floor(spread));
}

/** CPU mirror of the vertex shader's pulse. */
export function pulseScale(
  base: number,
  timeSeconds: number,
  rate: number,
  phase: number,
  recency: number,
): number {
  return base * (1 + PULSE_AMPLITUDE * Math.sin(timeSeconds * rate + phase) * recency);
}

/**
 * CPU mirror of the vertex shader's horizon test, globe centred at the origin.
 * The prompt's rule hides a pin when
 *   dot(normalize(P - C), normalize(cam - C)) < R / |cam - C|
 * and this fades it in over a band just inside that line:
 *   visibility = smoothstep(h, h + HORIZON_FADE_FRACTION · (1 - h), facing)
 * The band scales with the visible cap (1 - h), so the fade is a few degrees of
 * arc from orbit and a few kilometres from 50 km up.
 */
export function horizonVisibility(
  px: number,
  py: number,
  pz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const cameraDistance = Math.hypot(cx, cy, cz);
  const horizon = GLOBE_RADIUS / cameraDistance;
  const facing = (px * cx + py * cy + pz * cz) / (Math.hypot(px, py, pz) * cameraDistance);
  const edge = horizon + HORIZON_FADE_FRACTION * (1 - horizon);
  const t = Math.min(Math.max((facing - horizon) / (edge - horizon), 0), 1);
  return t * t * (3 - 2 * t);
}
