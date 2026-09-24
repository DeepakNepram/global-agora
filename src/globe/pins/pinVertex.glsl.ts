/**
 * Pin vertex shader: one camera-facing quad per slot, drawn as a story's pin,
 * as a cluster's orb, or nothing, somewhere along its path between two ends.
 *
 * The bloom runs here. Each slot carries a path (inner end = parent, outer end
 * = child) and a spring; this shader evaluates the spring at uTime and places
 * the quad on the path, so a bloom costs the CPU one uniform per frame.
 *
 * Positions are in the Earth-fixed frame (the mesh sits inside the tilt
 * group), and so is uCameraLocal, so the horizon test is plain geometry about
 * the origin. GLSL1 (three's ShaderMaterial default).
 */

import { GLOBE_RADIUS, NEWS_CATEGORIES } from '@/core';

import { glslFloat } from '../hdr';
import { BADGE_CODE_GLSL } from './badgeGlyphs';
import { BLOOM_OMEGA, BLOOM_SETTLE_SECONDS } from './bloom';
import {
  COLOR_GAIN_NEW,
  COLOR_GAIN_OLD,
  HIDDEN_SCALE,
  HORIZON_FADE_FRACTION,
  HOT_CORE_MAX,
  HOT_RECENCY_START,
  ORB_COLOR_GAIN,
  ORB_SCALE_MIN,
  ORB_SCALE_PER_DECADE,
  PULSE_AMPLITUDE,
  SCALE_MAX,
  SCALE_MIN,
} from './pinStyle';

export const PIN_VERT = /* glsl */ `
/** Inner end: anchor xyz on the unit sphere, then its look. */
attribute vec4 aInner;
/** Outer end, likewise. */
attribute vec4 aOuter;
/** Screen offsets at the inner (xy) and outer (zw) ends, CSS px, y up. */
attribute vec4 aOffsets;
/** Spring: u0, v0, t0, target. */
attribute vec4 aSpring;
/** Pulse phase, pulse rate, recency (−1 before publication), path twist. */
attribute vec4 aPulse;

/** Camera position in the Earth-fixed frame, updated before every draw. */
uniform vec3 uCameraLocal;
/** Clock, seconds: drives both the pulse and the springs. */
uniform float uTime;
/** 1 pulses, 0 holds still (reduced motion). */
uniform float uPulse;
/** Drawing-buffer size in pixels. */
uniform vec2 uViewport;
/** Quad half-size at scale 1, in drawing-buffer pixels. */
uniform float uHalfSizePx;
/** Drawing-buffer pixels per CSS pixel. */
uniform float uPixelRatio;
/** Linear RGB per category, brightest channel 1. */
uniform vec3 uPalette[${NEWS_CATEGORIES.length}];

varying vec2 vCorner;
varying vec3 vColor;
varying float vAlpha;
varying float vHalfSizePx;
varying float vHaloWeight;
varying float vHot;
/** Orb-ness, the inner and outer badge codes, and the badge cross-fade. */
varying vec4 vOrb;

const float GLOBE_RADIUS = ${glslFloat(GLOBE_RADIUS)};
const float HORIZON_FADE = ${glslFloat(HORIZON_FADE_FRACTION)};
const float PULSE_AMPLITUDE = ${glslFloat(PULSE_AMPLITUDE)};
const float OMEGA = ${glslFloat(BLOOM_OMEGA)};
const float SETTLE = ${glslFloat(BLOOM_SETTLE_SECONDS)};
const float SCALE_MIN = ${glslFloat(SCALE_MIN)};
const float SCALE_MAX = ${glslFloat(SCALE_MAX)};
const float ORB_SCALE_MIN = ${glslFloat(ORB_SCALE_MIN)};
const float ORB_SCALE_PER_DECADE = ${glslFloat(ORB_SCALE_PER_DECADE)};
const float HIDDEN_SCALE = ${glslFloat(HIDDEN_SCALE)};
const float COLOR_GAIN_OLD = ${glslFloat(COLOR_GAIN_OLD)};
const float COLOR_GAIN_NEW = ${glslFloat(COLOR_GAIN_NEW)};
const float ORB_COLOR_GAIN = ${glslFloat(ORB_COLOR_GAIN)};
const float HOT_RECENCY_START = ${glslFloat(HOT_RECENCY_START)};
const float HOT_CORE_MAX = ${glslFloat(HOT_CORE_MAX)};
const float LOG10_2 = 0.30103;

${BADGE_CODE_GLSL}

// look = kind + 4 · category + 32 · value; kind 0 hidden pin, 1 pin, 2 orb, 3 hidden orb.
float lookKind(float look) { return mod(look, 4.0); }
float lookValue(float look) { return floor(look / 32.0); }
float isOrb(float kind) { return step(1.5, kind); }
float isShown(float kind) { return step(0.5, kind) * step(kind, 2.5); }

// Quad scale of one end:
//   pin: SCALE_MIN + (SCALE_MAX − SCALE_MIN) · sqrt(heat / 255)
//   orb: ORB_SCALE_MIN + ORB_SCALE_PER_DECADE · log10(count)
// and HIDDEN_SCALE of that when the end is hidden.
float endScale(float look) {
  float kind = lookKind(look);
  float value = lookValue(look);
  float pin = SCALE_MIN + (SCALE_MAX - SCALE_MIN) * sqrt(clamp(value, 0.0, 255.0) / 255.0);
  float orb = ORB_SCALE_MIN + ORB_SCALE_PER_DECADE * log2(max(value, 1.0)) * LOG10_2;
  return mix(pin, orb, isOrb(kind)) * mix(HIDDEN_SCALE, 1.0, isShown(kind));
}

// Colour of one end: the category hue, scaled by recency for a pin
//   gain = COLOR_GAIN_OLD + (COLOR_GAIN_NEW − COLOR_GAIN_OLD) · recency
// and held at ORB_COLOR_GAIN for an orb.
vec3 endColor(float look, float recency) {
  float kind = lookKind(look);
  int category = int(mod(floor(look / 4.0), 8.0) + 0.5);
  float gain = mix(COLOR_GAIN_OLD + (COLOR_GAIN_NEW - COLOR_GAIN_OLD) * recency, ORB_COLOR_GAIN, isOrb(kind));
  return uPalette[category] * gain;
}

void main() {
  // Critically damped spring from (u0, v0) at t0 toward the target:
  //   τ = max(0, t − t0),  Δ = u0 − target
  //   u = target + (Δ + (v0 + ωΔ) τ) · e^(−ωτ)
  // From the settle time on it is exactly the target, so a hidden slot is
  // exactly invisible and culled below rather than drawn at alpha 0.0001.
  float tau = max(uTime - aSpring.z, 0.0);
  float delta = aSpring.x - aSpring.w;
  float u = clamp(aSpring.w + (delta + (aSpring.y + OMEGA * delta) * tau) * exp(-OMEGA * tau), 0.0, 1.0);
  if (tau >= SETTLE) u = aSpring.w;

  // The path spirals about the parent: at progress u the point is turned
  //   ψ = (1 − u) · twist
  // about the inner anchor (Rodrigues), v' = v cosψ + (k × v) sinψ + k (k·v)(1 − cosψ),
  // and the screen offset by the same angle, so a petal and a child with its
  // own place both wind out the same way.
  float psi = (1.0 - u) * aPulse.w;
  float c = cos(psi);
  float s = sin(psi);
  vec3 k = normalize(aInner.xyz);
  vec3 p = normalize(mix(aInner.xyz, aOuter.xyz, u));
  vec3 centre = p * c + cross(k, p) * s + k * dot(k, p) * (1.0 - c);
  vec2 offsetCss = mix(aOffsets.xy, aOffsets.zw, u);
  vec2 offset = vec2(offsetCss.x * c - offsetCss.y * s, offsetCss.x * s + offsetCss.y * c) * uPixelRatio;

  // Opacity: the visible end dominates, so a child is whole within the first
  // 30 % of its way out and fades in the last 30 % of its way back:
  //   w = shownOuter ≥ shownInner ? smoothstep(0, 0.3, u) : smoothstep(0.7, 1, u)
  // A pin end also waits for its story's publish time (recency ≥ 0).
  float innerKind = lookKind(aInner.w);
  float outerKind = lookKind(aOuter.w);
  float published = step(0.0, aPulse.z);
  float shownInner = isShown(innerKind) * max(published, isOrb(innerKind));
  float shownOuter = isShown(outerKind) * max(published, isOrb(outerKind));
  float w = shownOuter >= shownInner ? smoothstep(0.0, 0.3, u) : smoothstep(0.7, 1.0, u);
  float shown = mix(shownInner, shownOuter, w);

  // Horizon, globe centred at the origin: a point is behind the globe when
  //   dot(normalize(P - C), normalize(cam - C)) < R / |cam - C|
  // Fading in over a band inside that line, scaled to the visible cap (1 - h),
  // avoids a pop without letting a pin show past the limb.
  float cameraDistance = length(uCameraLocal);
  float horizon = GLOBE_RADIUS / cameraDistance;
  float facing = dot(centre, uCameraLocal / cameraDistance);
  float visibility = smoothstep(horizon, horizon + HORIZON_FADE * (1.0 - horizon), facing) * shown;

  float recency = max(aPulse.z, 0.0);
  float orbness = mix(isOrb(innerKind), isOrb(outerKind), u);
  vCorner = position.xy;
  vColor = mix(endColor(aInner.w, recency), endColor(aOuter.w, recency), u);
  //   hot = HOT_CORE_MAX · clamp((recency − start) / (1 − start), 0, 1), pins only
  vHot = HOT_CORE_MAX * clamp((recency - HOT_RECENCY_START) / (1.0 - HOT_RECENCY_START), 0.0, 1.0) * (1.0 - orbness);
  vOrb = vec4(
    orbness,
    badgeCode(isOrb(innerKind) * lookValue(aInner.w)),
    badgeCode(isOrb(outerKind) * lookValue(aOuter.w)),
    smoothstep(0.3, 0.7, u)
  );
  vAlpha = visibility;

  if (visibility <= 0.0) {
    // z/w = 2 is outside the clip volume at every corner, so a hidden slot
    // rasterises nothing and costs four vertex invocations.
    vHalfSizePx = 0.0;
    vHaloWeight = 0.0;
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }

  // Pins keep their pixel size, but the ground they sit on is foreshortened,
  // so near the limb they crowd together on screen by 1 / mu, where
  //   mu = dot(normalize(P), normalize(cam - P))   cosine of the view angle to the ground
  // Additive halos would sum into a bright ring there. Weighting each halo by
  // mu keeps the glow per unit of screen even across the disc; dots stay whole.
  vHaloWeight = max(dot(centre, normalize(uCameraLocal - centre)), 0.0);

  //   scale = base * (1 + PULSE_AMPLITUDE * sin(time * rate + phase) * recency)   pins only
  float pulse = 1.0 + PULSE_AMPLITUDE * sin(uTime * aPulse.y + aPulse.x) * recency * uPulse * (1.0 - orbness);
  vHalfSizePx = uHalfSizePx * mix(endScale(aInner.w), endScale(aOuter.w), u) * pulse;

  // Billboard in clip space: offsetting xy by (pixels * 2 / viewport) * w moves
  // the corner that many pixels after the perspective divide, so the quad
  // always faces the camera and keeps its pixel size at every altitude. The
  // petal offset rides along the same way.
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(centre, 1.0);
  clip.xy += (position.xy * vHalfSizePx + offset) * (2.0 / uViewport) * clip.w;
  gl_Position = clip;
}
`;
