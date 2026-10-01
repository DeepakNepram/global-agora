import { Color } from 'three';

import { GLOBE_RADIUS, NEWS_CATEGORIES } from '@/core';

/**
 * How a story becomes a pin: colour from category, brightness and pulse from
 * freshness, size from heat. Shaders interpolate these constants, and the CPU
 * mirrors below exist so tests can check the maths the GPU runs.
 */

const TAU = Math.PI * 2;

/**
 * The prompt's life of a pin, in story time (age = displayed instant − publish
 * time), evaluated on the GPU so a scrub costs one uniform:
 *   birth      grows in over FRESH_BIRTH_SECONDS, with a small pop
 *   freshness  f = 1 for FRESH_PEAK_SECONDS ("brightest for ~30 minutes"),
 *              then f = e^(−(age − peak) / FRESH_FADE_SECONDS) ("fades over the following hours")
 * During Play (a day in 20 s) the birth lasts about four frames and the peak
 * about 0.4 s, so each story sparks, glows and dims as the day passes.
 */
export const FRESH_BIRTH_SECONDS = 5 * 60;
export const FRESH_PEAK_SECONDS = 30 * 60;
export const FRESH_FADE_SECONDS = 3 * 3600;
/** The birth's overshoot: scale peaks about 18 % above full at 70 % of the way in. */
export const BIRTH_POP = 0.5;
/** A fresh pin draws this much larger, so the newest news reads from orbit. */
export const FRESH_SCALE_BOOST = 0.15;

/** The prompt's pulse: scale = base · (1 + PULSE_AMPLITUDE · sin(t·rate + phase) · freshness). */
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
 * blooms: HOT_CORE_MAX through the peak, falling to 0 as freshness drops to
 * HOT_FRESHNESS_START (about 2.9 hours old). The colour stays in the dot's rim
 * and the halo, the way a bright light photographs.
 */
export const HOT_FRESHNESS_START = 0.45;
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

/**
 * A cluster orb's quad scale (× PIN_HALF_SIZE_CSS_PX), growing a step per
 * tenfold count so a 1,000-story orb is bigger than a 10-story one without
 * swamping its neighbours: scale = ORB_SCALE_MIN + ORB_SCALE_PER_DECADE · log10(count).
 * 2 stories ≈ 2.1 (a 23 px disc), 100 ≈ 2.7, 1,000 ≈ 3.05.
 */
export const ORB_SCALE_MIN = 2.0;
export const ORB_SCALE_PER_DECADE = 0.35;
/** An orb's disc radius as a fraction of its quad half-size; the rest is halo. */
export const ORB_CORE_RADIUS = 0.6;
/** The orb's dark ring reaches this far, like SHADOW_RADIUS for a pin. */
export const ORB_SHADOW_RADIUS = 0.78;
/** How much an orb's rim darkens, giving the disc an edge on bright ground. */
export const ORB_RIM_DARKEN = 0.35;
/** Orbs keep one brightness, not their stories' freshness, so the count stays readable. */
export const ORB_COLOR_GAIN = 0.9;
/** A hidden end draws this small, so a pin grows out of an orb rather than popping. */
export const HIDDEN_SCALE = 0.25;
/**
 * The count's ink, linear RGB: near-black reads on every category hue, which
 * are saturated mid-tones (at least 4.5:1 for the darkest, violet).
 */
export const BADGE_INK: readonly [number, number, number] = [0.004, 0.005, 0.009];

/**
 * The selected story's pin (or the orb holding it) wears a ring, drawn in its
 * own quad grown by SELECTION_QUAD_SCALE to make room. The ring sits this far
 * outside the dot's edge, so it reads around pins of every size.
 */
export const SELECTION_QUAD_SCALE = 1.5;
export const SELECTION_RING_GAP_CSS_PX = 4.5;
export const SELECTION_RING_WIDTH_CSS_PX = 1.75;
/** Linear RGB, under bloom's threshold: an outline, not a light. */
export const SELECTION_RING_COLOR: readonly [number, number, number] = [0.92, 0.95, 1.0];

/**
 * A story the filters leave out is drawn this much fainter and smaller, with
 * no halo and no pulse: still there, so the globe never goes dark, but quiet.
 */
export const FILTERED_ALPHA = 0.3;
export const FILTERED_SCALE = 0.6;

export function orbScaleFor(count: number): number {
  return ORB_SCALE_MIN + ORB_SCALE_PER_DECADE * Math.log10(Math.max(count, 1));
}

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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** 1 through the peak, then fading over hours; 0 before publication. */
export function freshnessFor(ageSeconds: number): number {
  if (ageSeconds < 0) return 0;
  if (ageSeconds <= FRESH_PEAK_SECONDS) return 1;
  return Math.exp(-(ageSeconds - FRESH_PEAK_SECONDS) / FRESH_FADE_SECONDS);
}

/** How far a story has grown in: 0 before publication, 1 from FRESH_BIRTH_SECONDS on. */
export function birthFor(ageSeconds: number): number {
  return smoothstep(0, FRESH_BIRTH_SECONDS, ageSeconds);
}

/**
 * A pin's scale through its birth and peak:
 *   (HIDDEN_SCALE + (1 − HIDDEN_SCALE)·b + BIRTH_POP·sin(π·b)) · (1 + FRESH_SCALE_BOOST·f)
 * growing from a hidden end's size with a pop, then easing to its heat's size as it ages.
 */
export function lifeScaleFor(ageSeconds: number): number {
  const b = birthFor(ageSeconds);
  const grow = HIDDEN_SCALE + (1 - HIDDEN_SCALE) * b + BIRTH_POP * Math.sin(Math.PI * b);
  return grow * (1 + FRESH_SCALE_BOOST * freshnessFor(ageSeconds));
}

/** Angular pulse rate in rad/s. */
export function pulseRateFor(freshness: number): number {
  return TAU * (PULSE_HZ_OLD + (PULSE_HZ_NEW - PULSE_HZ_OLD) * freshness);
}

export function colorGainFor(freshness: number): number {
  return COLOR_GAIN_OLD + (COLOR_GAIN_NEW - COLOR_GAIN_OLD) * freshness;
}

/** White added at the dot's centre: HOT_CORE_MAX through the peak, 0 for older stories. */
export function hotFor(freshness: number): number {
  const t = (freshness - HOT_FRESHNESS_START) / (1 - HOT_FRESHNESS_START);
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
  freshness: number,
): number {
  return base * (1 + PULSE_AMPLITUDE * Math.sin(timeSeconds * rate + phase) * freshness);
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
