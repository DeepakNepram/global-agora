/**
 * Atmosphere shell shaders.
 *
 * Both run on the BACK faces of a sphere slightly larger than the Earth, in the
 * shell's object space, which is the Earth-fixed frame of uSunDir (the shell sits
 * in the tilt group and never spins). uCameraLocal is the camera in that frame.
 *
 *   RIM_FRAG      LOW/MEDIUM. One pow and a few dots, halo outside the limb only
 *                 (the Earth's depth rejects the rest before shading).
 *   SCATTER_FRAG  HIGH. Six-sample in-scatter march along the view ray, drawn
 *                 without depth test so the haze also lies over the limb.
 */

import { ATMOSPHERE_MAX_LUMINANCE, glslFloat } from '../hdr';

/** Shell radius in globe radii. The shaders' ray maths is built on this value. */
export const ATMOSPHERE_RADIUS = 1.03;

const SHARED = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uCameraLocal;
varying vec3 vPosition;

const float ATMOSPHERE_RADIUS = ${glslFloat(ATMOSPHERE_RADIUS)};
const float MAX_LUMINANCE = ${glslFloat(ATMOSPHERE_MAX_LUMINANCE)};
`;

export const ATMOSPHERE_VERT = /* glsl */ `
varying vec3 vPosition;

void main() {
  // Object-space position of a sphere centred on the origin doubles as its normal.
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RIM_FRAG = /* glsl */ `
${SHARED}
const vec3 DAY_TINT = vec3(0.26, 0.5, 1.0);
const float RIM_INTENSITY = 2.2;

void main() {
  vec3 normal = normalize(vPosition);
  vec3 viewDir = normalize(uCameraLocal - vPosition);

  //   rim = (1 - |v . n|)^3        Fresnel-style: grazing view -> bright
  float rim = pow(1.0 - abs(dot(viewDir, normal)), 3.0);

  // On a back face the rim peaks at the shell's own silhouette, which would draw
  // a hard outer ring. Fade by the altitude of the ray's closest approach to the
  // centre instead, so the glow hugs the limb and thins to nothing at the edge:
  //   closest  = p - d (p . d)       d = view ray direction
  //   altitude = (|closest| - 1) / (R - 1)
  vec3 ray = -viewDir;
  vec3 closest = vPosition - ray * dot(vPosition, ray);
  float impact = length(closest);
  float altitude = clamp((impact - 1.0) / (ATMOSPHERE_RADIUS - 1.0), 0.0, 1.0);
  float falloff = (1.0 - altitude) * (1.0 - altitude);

  // Sun as seen by the limb point under the ray, not by the far-side fragment.
  float sunFacing = dot(closest / max(impact, 1e-4), uSunDir);
  float daylight = smoothstep(-0.2, 0.2, sunFacing);  // gone on the night side
  float brighten = mix(0.55, 1.0, max(sunFacing, 0.0));

  vec3 color = DAY_TINT * (rim * falloff * daylight * brighten * RIM_INTENSITY);
  gl_FragColor = vec4(min(color, vec3(MAX_LUMINANCE)), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const SCATTER_FRAG = /* glsl */ `
${SHARED}
const int SAMPLES = 6;

// Density falls off as exp(-h / SCALE_HEIGHT), h in shell thicknesses.
const float SCALE_HEIGHT = 0.25;

// Extinction per world unit at ground level. Rayleigh is proportional to
// 1/lambda^4 (680/550/440nm -> 0.175 : 0.41 : 1), so blue scatters most; the
// aerosol term is grey and is what carries reddened sunlight near the terminator.
// Tuned for looks, not Earth: vertical blue depth ~0.05 keeps the disc's colour
// (at 16 it washed the Pacific teal-grey), while a grazing path through the limb
// is ~30x longer and still glows.
const vec3 BETA_RAYLEIGH = vec3(0.175, 0.41, 1.0) * 6.0;
const float BETA_AEROSOL = 1.0;

// Air mass toward the sun is 1 / (mu + k): ~1 overhead, 1/k on the horizon.
// k = 0.02 (air mass 50) keeps sunlight blue until the sun is within ~2° of the
// horizon, then strips the blue out: the reddening stays a thin band at the
// terminator instead of tinting the whole low-sun hemisphere.
const float AIR_MASS_K = 0.02;
const float SUN_INTENSITY = 1.3;
const float AEROSOL_G = 0.6;

// Returns (near, far) hit distances; near > far on a miss.
vec2 raySphere(vec3 origin, vec3 dir, float radius) {
  float b = dot(origin, dir);
  float c = dot(origin, origin) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1e9, -1e9);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

void main() {
  vec3 origin = uCameraLocal;
  vec3 dir = normalize(vPosition - origin);

  vec2 shell = raySphere(origin, dir, ATMOSPHERE_RADIUS);
  vec2 ground = raySphere(origin, dir, 1.0);
  float start = max(shell.x, 0.0);
  float end = shell.y;
  if (ground.x <= ground.y && ground.x > 0.0) end = min(end, ground.x);
  if (end <= start) discard;

  float thickness = ATMOSPHERE_RADIUS - 1.0;
  float ds = (end - start) / float(SAMPLES);
  vec3 beta = BETA_RAYLEIGH + vec3(BETA_AEROSOL);

  //   L = sum_i  rho_i * ds * lit_i * exp(-(tau_sun_i + tau_view_i))
  //   tau_sun_i  = beta * rho_i * H * airMass(mu_i)     closed form, no inner march
  vec3 inscatter = vec3(0.0);
  vec3 viewDepth = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    vec3 p = origin + dir * (start + ds * (float(i) + 0.5));
    float r = length(p);
    float h = max(r - 1.0, 0.0) / thickness;
    float density = exp(-h / SCALE_HEIGHT);
    float mu = dot(p / r, uSunDir);

    vec3 stepDepth = beta * density * ds;
    viewDepth += 0.5 * stepDepth;
    vec3 sunDepth = beta * density * SCALE_HEIGHT * thickness / (max(mu, 0.0) + AIR_MASS_K);
    // Same +-0.10 band as the surface terminator.
    float lit = smoothstep(-0.10, 0.10, mu);
    inscatter += density * ds * lit * exp(-(sunDepth + viewDepth));
    viewDepth += 0.5 * stepDepth;
  }

  //   Rayleigh phase  3/4 (1 + cos^2)
  //   aerosol phase   Henyey-Greenstein, normalised to 1 at g = 0
  float cosTheta = dot(dir, uSunDir);
  float phaseR = 0.75 * (1.0 + cosTheta * cosTheta);
  float g2 = AEROSOL_G * AEROSOL_G;
  float phaseA = (1.0 - g2) / pow(1.0 + g2 - 2.0 * AEROSOL_G * cosTheta, 1.5);
  vec3 color = inscatter * (BETA_RAYLEIGH * phaseR + BETA_AEROSOL * phaseA) * SUN_INTENSITY;

  // Premultiplied over the surface: dst * (1 - alpha) + color. With the surface
  // <= 1 and color <= alpha * MAX_LUMINANCE, the sum stays under the bloom
  // threshold (src/globe/hdr.ts). Alpha is the strongest (blue) extinction, not
  // the channel mean: against a mean, blue in-scatter always hit the cap and was
  // flattened to green's level, which is what turned the haze teal.
  float alpha = 1.0 - exp(-max(viewDepth.b, max(viewDepth.g, viewDepth.r)));
  gl_FragColor = vec4(min(color, vec3(alpha * MAX_LUMINANCE)), alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
