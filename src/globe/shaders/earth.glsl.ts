/**
 * Earth surface shaders.
 *
 * The default `lit` channel shades by the sun: day map on the sunlit side, city
 * lights on the night side, a soft terminator between them. The other channels
 * are the unlit inspection views from 1.1, kept so a texture problem can still
 * be told apart from a lighting problem.
 *
 * GLSL1 (three's ShaderMaterial default). three rewrites texture2D/gl_FragColor
 * for WebGL2 itself.
 */

import {
  NIGHT_BASE_GAIN,
  NIGHT_KEY_HIGH,
  NIGHT_KEY_LOW,
  NIGHT_LIGHTS_GAIN,
  glslFloat,
} from '../hdr';

/** Values for the uChannel uniform. Keep in sync with EARTH_FRAG. */
export const EARTH_CHANNEL_INDEX = {
  day: 0,
  night: 1,
  specular: 2,
  dayNight: 3,
  lit: 4,
} as const;

export type EarthChannel = keyof typeof EARTH_CHANNEL_INDEX;

export const EARTH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;

void main() {
  // SphereGeometry's own UVs, not UVs derived from position. Its seam column is
  // duplicated (u = 0 and u = 1 at the same position), so u rises monotonically
  // across the last quad and the mip derivative never wraps. atan-from-position
  // UVs jump from 1 back to 0 inside one triangle and draw a visible seam line.
  vUv = uv;

  // Object-space normal, deliberately not normalMatrix * normal. The sun
  // direction arrives in the same Earth-fixed frame as the texture, so lighting
  // is independent of the axial tilt, the camera, and any later globe spin.
  vNormal = normal;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const EARTH_FRAG = /* glsl */ `
uniform sampler2D uDayMap;
uniform sampler2D uNightMap;
uniform sampler2D uSpecularMask;
/** Unit vector toward the sun, Earth-fixed frame (src/core/sun.ts). */
uniform vec3 uSunDir;
uniform int uChannel;

varying vec2 vUv;
varying vec3 vNormal;

// Half-width of the terminator blend in ndl units. ndl is sin(solar elevation),
// so 0.10 is the sun ~5.7° above or below the horizon.
const float TERMINATOR_HALF_WIDTH = 0.10;
// Night gain keyed on texel luminance (src/globe/hdr.ts): the dim base keeps an
// LDR gain, city cores get an HDR one that exceeds the bloom threshold.
const float NIGHT_BASE_GAIN = ${glslFloat(NIGHT_BASE_GAIN)};
const float NIGHT_LIGHTS_GAIN = ${glslFloat(NIGHT_LIGHTS_GAIN)};
const float NIGHT_KEY_LOW = ${glslFloat(NIGHT_KEY_LOW)};
const float NIGHT_KEY_HIGH = ${glslFloat(NIGHT_KEY_HIGH)};

// City lights fade in over this much ndl below the horizon (sun ~2.3° down).
// Fading them across the full band left a dark stripe between the night map and
// the dim low-sun ground; this keeps the night side readable up to the line.
const float LIGHTS_FADE = 0.04;

// Low sun warms the ground it still lights: full warmth on the terminator, gone
// by ndl 0.25 (sun ~14.5° up). Kept subtle: the atmosphere pass adds its own
// reddening on the HIGH tier.
const vec3 LOW_SUN_TINT = vec3(1.0, 0.75, 0.55);
const float LOW_SUN_END = 0.25;

void main() {
  // All three maps are sampled unconditionally. uChannel is a runtime uniform,
  // not a compile-time constant, so none of these fetches can be eliminated —
  // switching channels proves every binding rather than one of three.
  // sRGB maps arrive already decoded to linear (sampled from an SRGB8_ALPHA8
  // texture); the specular mask is uploaded as linear data.
  vec3 day = texture2D(uDayMap, vUv).rgb;
  vec3 night = texture2D(uNightMap, vUv).rgb;
  float ocean = texture2D(uSpecularMask, vUv).r;

  // Interpolated normals shorten between vertices; renormalise so ndl is exact.
  float ndl = dot(normalize(vNormal), uSunDir);

  //   t   = smoothstep(-w, w, ndl)                   0 night .. 1 day
  //   col = mix(lights, day * max(ndl, 0), t)        Lambert day, lights at night
  float t = smoothstep(-TERMINATOR_HALF_WIDTH, TERMINATOR_HALF_WIDTH, ndl);

  // The blend alone would leave lights at 45% on the terminator and 14% with the
  // sun 3° up. This mask is exactly 0 for ndl >= 0, so lights exist only where
  // the sun has set:
  //   lightsOn = 1 - smoothstep(-LIGHTS_FADE, 0, ndl)
  float lightsOn = 1.0 - smoothstep(-LIGHTS_FADE, 0.0, ndl);
  //   gain = mix(base, lights, smoothstep(keyLow, keyHigh, luminance(night)))
  float nightLuminance = dot(night, vec3(0.2126, 0.7152, 0.0722));
  float nightGain = mix(
    NIGHT_BASE_GAIN,
    NIGHT_LIGHTS_GAIN,
    smoothstep(NIGHT_KEY_LOW, NIGHT_KEY_HIGH, nightLuminance)
  );
  vec3 lights = night * nightGain * lightsOn;

  //   lowSun = 1 - smoothstep(0, LOW_SUN_END, ndl)   1 at sunrise, 0 by ~14.5° up
  float lowSun = 1.0 - smoothstep(0.0, LOW_SUN_END, ndl);
  vec3 sunlit = day * max(ndl, 0.0) * mix(vec3(1.0), LOW_SUN_TINT, lowSun);

  vec3 lit = mix(lights, sunlit, t);

  vec3 color = day;
  if (uChannel == 1) {
    color = night;
  } else if (uChannel == 2) {
    color = vec3(ocean);
  } else if (uChannel == 3) {
    // Debug overlay, not lighting: city lights added over the day map so any
    // offset between the two maps shows up as lights sitting off their coasts.
    color = day + night;
  } else if (uChannel == 4) {
    color = lit;
  }

  gl_FragColor = vec4(color, 1.0);

  // ACES when three tone-maps per material (LOW tier); compiles to nothing when a
  // composer renders to a buffer and tone-maps once at the end.
  #include <tonemapping_fragment>

  // Raw ShaderMaterial gets linearToOutputTexel defined but never called. Without
  // this include the linear result is written straight to an sRGB canvas and the
  // globe renders dark and muddy. Must stay the last statement.
  #include <colorspace_fragment>
}
`;
