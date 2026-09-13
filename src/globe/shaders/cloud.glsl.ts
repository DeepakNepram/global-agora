/**
 * Cloud shell shaders.
 *
 * Clouds share the surface's terminator. Unlit, they would stay bright white
 * across the night side and bury the city lights under a daytime layer.
 *
 * The cloud WebP is flat-white RGB with coverage in alpha (see
 * scripts/process-textures.ts), so the sampled alpha is the only per-texel data.
 */

export const CLOUD_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;

void main() {
  vUv = uv;
  // Object space of the cloud shell, which spins relative to the ground; the
  // host rotates uSunDir into this frame (see src/globe/sunFrame.ts).
  vNormal = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const CLOUD_FRAG = /* glsl */ `
uniform sampler2D uCloudMap;
/** Unit vector toward the sun, in the cloud shell's own frame. */
uniform vec3 uSunDir;

varying vec2 vUv;
varying vec3 vNormal;

// Must match EARTH_FRAG so clouds and ground go dark along the same line.
const float TERMINATOR_HALF_WIDTH = 0.10;

// Same low-sun warmth as EARTH_FRAG, reaching a little higher: cloud tops
// catch sunset colour while the ground beneath is already in shade.
const vec3 LOW_SUN_TINT = vec3(1.0, 0.72, 0.5);
const float LOW_SUN_END = 0.3;

// Unlit clouds at night are dark, not gone: they dim the lights beneath them
// without drawing black blotches over every city.
const float NIGHT_OPACITY = 0.35;

void main() {
  vec4 cloud = texture2D(uCloudMap, vUv);

  float ndl = dot(normalize(vNormal), uSunDir);
  float t = smoothstep(-TERMINATOR_HALF_WIDTH, TERMINATOR_HALF_WIDTH, ndl);

  //   shade = max(ndl, 0) * t * mix(1, LOW_SUN_TINT, lowSun)   same day term as the surface
  float lowSun = 1.0 - smoothstep(0.0, LOW_SUN_END, ndl);
  vec3 color = cloud.rgb * (max(ndl, 0.0) * t) * mix(vec3(1.0), LOW_SUN_TINT, lowSun);

  float alpha = cloud.a * mix(NIGHT_OPACITY, 1.0, t);

  gl_FragColor = vec4(color, alpha);

  // See EARTH_FRAG: raw ShaderMaterial needs this to write to an sRGB canvas.
  #include <colorspace_fragment>
}
`;
