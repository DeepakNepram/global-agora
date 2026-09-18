/**
 * Pin shaders: one camera-facing quad per story, drawn as a crisp dot with a
 * soft additive halo.
 *
 * Positions arrive in the Earth-fixed frame (the mesh sits inside the tilt
 * group), and so does uCameraLocal, so the horizon test is plain geometry about
 * the origin. GLSL1 (three's ShaderMaterial default).
 */

import { GLOBE_RADIUS } from '@/core';

import { glslFloat } from '../hdr';
import {
  CORE_RADIUS,
  HALO_PEAK,
  HORIZON_FADE_FRACTION,
  PULSE_AMPLITUDE,
  SHADOW_OPACITY,
  SHADOW_RADIUS,
} from './pinStyle';

export const PIN_VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aColor;
attribute float aScale;
attribute float aAlpha;
attribute float aPhase;
attribute float aRate;
attribute float aRecency;
/** White added at the dot's centre; > 0 only for fresh stories. */
attribute float aHot;

/** Camera position in the Earth-fixed frame, updated before every draw. */
uniform vec3 uCameraLocal;
/** Pulse clock, seconds. */
uniform float uTime;
/** 1 pulses, 0 holds still (reduced motion). */
uniform float uPulse;
/** Drawing-buffer size in pixels. */
uniform vec2 uViewport;
/** Quad half-size at scale 1, in drawing-buffer pixels. */
uniform float uHalfSizePx;

varying vec2 vCorner;
varying vec3 vColor;
varying float vAlpha;
varying float vHalfSizePx;
varying float vHaloWeight;
varying float vHot;

const float GLOBE_RADIUS = ${glslFloat(GLOBE_RADIUS)};
const float HORIZON_FADE = ${glslFloat(HORIZON_FADE_FRACTION)};
const float PULSE_AMPLITUDE = ${glslFloat(PULSE_AMPLITUDE)};

void main() {
  // Horizon, globe centred at the origin: a pin is behind the globe when
  //   dot(normalize(P - C), normalize(cam - C)) < R / |cam - C|
  // Fading in over a band inside that line, scaled to the visible cap (1 - h),
  // avoids a pop without letting a pin show past the limb.
  float cameraDistance = length(uCameraLocal);
  float horizon = GLOBE_RADIUS / cameraDistance;
  float facing = dot(normalize(aCenter), uCameraLocal / cameraDistance);
  float visibility = smoothstep(horizon, horizon + HORIZON_FADE * (1.0 - horizon), facing) * aAlpha;

  vCorner = position.xy;
  vColor = aColor;
  vHot = aHot;
  vAlpha = visibility;

  if (visibility <= 0.0) {
    // z/w = 2 is outside the clip volume at every corner, so a hidden pin
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
  vHaloWeight = max(dot(normalize(aCenter), normalize(uCameraLocal - aCenter)), 0.0);

  //   scale = base * (1 + PULSE_AMPLITUDE * sin(time * rate + phase) * recency)
  float pulse = 1.0 + PULSE_AMPLITUDE * sin(uTime * aRate + aPhase) * aRecency * uPulse;
  vHalfSizePx = uHalfSizePx * aScale * pulse;

  // Billboard in clip space: offsetting xy by (pixels * 2 / viewport) * w moves
  // the corner that many pixels after the perspective divide, so the quad
  // always faces the camera and keeps its pixel size at every altitude.
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(aCenter, 1.0);
  clip.xy += position.xy * vHalfSizePx * (2.0 / uViewport) * clip.w;
  gl_Position = clip;
}
`;

export const PIN_FRAG = /* glsl */ `
varying vec2 vCorner;
varying vec3 vColor;
varying float vAlpha;
varying float vHalfSizePx;
varying float vHaloWeight;
varying float vHot;

const float CORE_RADIUS = ${glslFloat(CORE_RADIUS)};
const float HALO_PEAK = ${glslFloat(HALO_PEAK)};
const float SHADOW_OPACITY = ${glslFloat(SHADOW_OPACITY)};
const float SHADOW_RADIUS = ${glslFloat(SHADOW_RADIUS)};

void main() {
  // Distance from the pin's centre in quad half-sizes: 0 centre, 1 edge.
  float r = length(vCorner);

  // Signed distance to the dot's edge, in pixels, gives a one-pixel antialiased
  // rim at any size without derivatives:
  //   core = clamp((CORE_RADIUS - r) * halfSizePx + 0.5, 0, 1)
  float core = clamp((CORE_RADIUS - r) * vHalfSizePx + 0.5, 0.0, 1.0);

  //   halo = HALO_PEAK * mu * (1 - smoothstep(CORE_RADIUS, 1, r))^2
  // Reaches 0 at the quad's inscribed circle, so the corners output nothing.
  // No discard: it defeats tile-based mobile GPUs' early fragment work.
  float fall = 1.0 - smoothstep(CORE_RADIUS, 1.0, r);
  float halo = HALO_PEAK * vHaloWeight * fall * fall;

  //   centre = 1 - smoothstep(0, CORE_RADIUS, r)       1 at the middle, 0 at the rim
  //   dot    = color + hot * centre^2                   white-hot middle, coloured rim
  float centre = 1.0 - smoothstep(0.0, CORE_RADIUS, r);
  vec3 dotColor = vColor + vec3(vHot * centre * centre);

  //   shadow = SHADOW_OPACITY * (1 - smoothstep(CORE_RADIUS, SHADOW_RADIUS, r))
  float shadow = SHADOW_OPACITY * (1.0 - smoothstep(CORE_RADIUS, SHADOW_RADIUS, r));

  // Premultiplied, blended with (ONE, ONE_MINUS_SRC_ALPHA), so one draw does
  // three things: the dot (alpha 1) covers the ground, the shadow ring (alpha
  // SHADOW_OPACITY, no colour) darkens it, and the halo (alpha 0) adds light.
  vec3 color = dotColor * core + vColor * halo * (1.0 - core);
  float coverage = core + shadow * (1.0 - core);
  gl_FragColor = vec4(color, coverage) * vAlpha;

  // See EARTH_FRAG for both includes.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
