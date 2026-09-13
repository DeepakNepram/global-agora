/**
 * Earth surface shaders — Phase 1.1, flat and unlit.
 *
 * There is no lighting and no terminator here on purpose: this pass exists to
 * prove the UV mapping before anything is layered on top of it. The terminator
 * replaces the channel switch wholesale in a later prompt.
 *
 * GLSL1 (three's ShaderMaterial default). three rewrites texture2D/gl_FragColor
 * for WebGL2 itself.
 */

/** Values for the uChannel uniform. Keep in sync with EARTH_FRAG. */
export const EARTH_CHANNEL_INDEX = {
  day: 0,
  night: 1,
  specular: 2,
  dayNight: 3,
} as const;

export type EarthChannel = keyof typeof EARTH_CHANNEL_INDEX;

export const EARTH_VERT = /* glsl */ `
varying vec2 vUv;

void main() {
  // SphereGeometry's own UVs, not UVs derived from position. Its seam column is
  // duplicated (u = 0 and u = 1 at the same position), so u rises monotonically
  // across the last quad and the mip derivative never wraps. atan-from-position
  // UVs jump from 1 back to 0 inside one triangle and draw a visible seam line.
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const EARTH_FRAG = /* glsl */ `
uniform sampler2D uDayMap;
uniform sampler2D uNightMap;
uniform sampler2D uSpecularMask;
uniform int uChannel;

varying vec2 vUv;

void main() {
  // All three maps are sampled unconditionally. uChannel is a runtime uniform,
  // not a compile-time constant, so none of these fetches can be eliminated —
  // switching channels proves every binding rather than one of three.
  // sRGB maps arrive already decoded to linear (sampled from an SRGB8_ALPHA8
  // texture); the specular mask is uploaded as linear data.
  vec3 day = texture2D(uDayMap, vUv).rgb;
  vec3 night = texture2D(uNightMap, vUv).rgb;
  float ocean = texture2D(uSpecularMask, vUv).r;

  vec3 color = day;
  if (uChannel == 1) {
    color = night;
  } else if (uChannel == 2) {
    color = vec3(ocean);
  } else if (uChannel == 3) {
    // Debug overlay, not lighting: city lights added over the day map so any
    // offset between the two maps shows up as lights sitting off their coasts.
    color = day + night;
  }

  gl_FragColor = vec4(color, 1.0);

  // Raw ShaderMaterial gets linearToOutputTexel defined but never called. Without
  // this include the linear result is written straight to an sRGB canvas and the
  // globe renders dark and muddy. Must stay the last statement.
  #include <colorspace_fragment>
}
`;
