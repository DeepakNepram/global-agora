/**
 * Pin fragment shader: a crisp shape (its category's, 5.1) with a soft
 * additive halo for a story, or a larger disc with a dark rim, its count and
 * its main category's mark for a cluster orb, blended by orb-ness as a slot
 * turns from one into the other. See pinVertex.glsl.ts.
 */

import { glslFloat } from '../hdr';
import { BADGE_CELL_ASPECT, BADGE_GLYPHS } from './badgeGlyphs';
import {
  BADGE_INK,
  CORE_RADIUS,
  HALO_PEAK,
  HOT_RADIUS,
  ORB_CORE_RADIUS,
  ORB_RIM_DARKEN,
  ORB_SHADOW_RADIUS,
  SELECTION_QUAD_SCALE,
  SELECTION_RING_COLOR,
  SELECTION_RING_GAP_CSS_PX,
  SELECTION_RING_WIDTH_CSS_PX,
  SHADOW_OPACITY,
  SHADOW_WIDTH,
} from './pinStyle';
import {
  ORB_MARK_CENTRE,
  ORB_MARK_OUTLINE_CSS_PX,
  ORB_MARK_RADIUS,
  ORB_REACH,
  PIN_REACH,
  PIN_SHAPES_FRAG,
} from './pinShapes.glsl';

const [INK_R, INK_G, INK_B] = BADGE_INK;
const [RING_R, RING_G, RING_B] = SELECTION_RING_COLOR;
const [MARK_X, MARK_Y] = ORB_MARK_CENTRE;

export const PIN_FRAG = /* glsl */ `
/** One row of glyphs, BADGE_GLYPHS in order, white on transparent. */
uniform sampler2D uBadgeAtlas;
/** 0 until the host supplies the atlas: orbs then draw without a count. */
uniform float uHasBadges;
/** Drawing-buffer pixels per CSS pixel. */
uniform float uPixelRatio;

varying vec2 vCorner;
varying vec3 vColor;
varying float vAlpha;
varying float vHalfSizePx;
varying float vHaloWeight;
varying float vHot;
varying vec4 vOrb;
varying float vSelected;
varying float vShape;

const float CORE_RADIUS = ${glslFloat(CORE_RADIUS)};
const float ORB_CORE_RADIUS = ${glslFloat(ORB_CORE_RADIUS)};
const float HALO_PEAK = ${glslFloat(HALO_PEAK)};
const float SHADOW_OPACITY = ${glslFloat(SHADOW_OPACITY)};
const float SHADOW_WIDTH = ${glslFloat(SHADOW_WIDTH)};
const float HOT_RADIUS = ${glslFloat(HOT_RADIUS)};
const float PIN_REACH = ${glslFloat(PIN_REACH)};
const float ORB_REACH = ${glslFloat(ORB_REACH)};
const vec2 MARK_CENTRE = vec2(${glslFloat(MARK_X)}, ${glslFloat(MARK_Y)});
const float MARK_RADIUS = ${glslFloat(ORB_MARK_RADIUS)};
const float MARK_OUTLINE_PX = ${glslFloat(ORB_MARK_OUTLINE_CSS_PX)};
const float ORB_SHADOW_RADIUS = ${glslFloat(ORB_SHADOW_RADIUS)};
const float ORB_RIM_DARKEN = ${glslFloat(ORB_RIM_DARKEN)};
const float GLYPH_COUNT = ${glslFloat(BADGE_GLYPHS.length)};
const float CELL_ASPECT = ${glslFloat(BADGE_CELL_ASPECT)};
const vec3 BADGE_INK = vec3(${glslFloat(INK_R)}, ${glslFloat(INK_G)}, ${glslFloat(INK_B)});
const float SELECTION_QUAD_SCALE = ${glslFloat(SELECTION_QUAD_SCALE)};
const float RING_GAP_PX = ${glslFloat(SELECTION_RING_GAP_CSS_PX)};
const float RING_WIDTH_PX = ${glslFloat(SELECTION_RING_WIDTH_CSS_PX)};
const vec3 RING_COLOR = vec3(${glslFloat(RING_R)}, ${glslFloat(RING_G)}, ${glslFloat(RING_B)});

${PIN_SHAPES_FRAG}
// Ink coverage of a badge at quad point p, for a code packed as
//   code = n + 16 · (g0 + 16 g1 + 256 g2 + 4096 g3)
// (see badgeGlyphs.ts). The text is centred and sized to the disc radius R:
//   height = R · min(1.25, 1.75 / (n · CELL_ASPECT))
// so one or two digits read large and four still fit inside the disc.
float badgeInk(float code, vec2 p, float radius) {
  float n = mod(code, 16.0);
  if (n < 0.5) return 0.0;
  float height = radius * min(1.25, 1.75 / (n * CELL_ASPECT));
  float advance = height * CELL_ASPECT;
  float cell = (p.x + 0.5 * n * advance) / advance;
  float v = p.y / height + 0.5;
  if (cell < 0.0 || cell >= n || v < 0.0 || v > 1.0) return 0.0;
  float glyphs = floor(code / 16.0);
  float glyph = mod(glyphs, 16.0);
  if (cell >= 1.0) glyph = mod(floor(glyphs / 16.0), 16.0);
  if (cell >= 2.0) glyph = mod(floor(glyphs / 256.0), 16.0);
  if (cell >= 3.0) glyph = floor(glyphs / 4096.0);
  // The atlas has no mipmaps, so sampling inside this branch is well defined.
  return texture2D(uBadgeAtlas, vec2((glyph + fract(cell)) / GLYPH_COUNT, v)).a;
}

void main() {
  // The selected slot's quad is SELECTION_QUAD_SCALE larger, to hold its
  // ring. Scaling its corner and pixel size back draws the pin itself exactly
  // as before, with everything past the old edge (r > 1) left to the ring.
  float grow = mix(1.0, SELECTION_QUAD_SCALE, vSelected);
  vec2 corner = vCorner * grow;
  float halfPx = vHalfSizePx / grow;

  // Distance from the quad's centre in quad half-sizes: 0 centre, 1 edge.
  float r = length(corner);
  float orb = vOrb.x;
  float radius = mix(CORE_RADIUS, ORB_CORE_RADIUS, orb);
  float shape = floor(vShape + 0.5);

  // Signed distance to the edge in quad half-sizes, negative inside: the
  // pin's category shape or the orb's disc, blended as one turns into the
  // other. Beyond the pin's reach and shadow, the distance to its circle is
  // near enough and skips the shape's maths.
  float pinEdge = r > PIN_REACH + SHADOW_WIDTH
    ? r - CORE_RADIUS
    : shapeDistance(corner / CORE_RADIUS, shape) * CORE_RADIUS;
  float edge = mix(pinEdge, r - ORB_CORE_RADIUS, orb);

  // The distance in pixels gives a one-pixel antialiased rim at any size
  // without derivatives:
  //   core = clamp(−edge · halfSizePx + 0.5, 0, 1)
  float core = clamp(-edge * halfPx + 0.5, 0.0, 1.0);

  //   halo = HALO_PEAK * mu * (1 - smoothstep(R, 1, r))^2
  // Reaches 0 at the quad's inscribed circle, so the corners output nothing.
  // No discard: it defeats tile-based mobile GPUs' early fragment work.
  float fall = 1.0 - smoothstep(radius, 1.0, r);
  float halo = HALO_PEAK * vHaloWeight * fall * fall;

  //   centre = 1 - smoothstep(0, HOT_RADIUS, r)   1 at the middle, 0 by the old dot's rim
  //   dot    = color + hot * centre^2              white-hot middle, coloured shape (pins)
  float centre = 1.0 - smoothstep(0.0, HOT_RADIUS, r);
  vec3 dotColor = vColor + vec3(vHot * centre * centre);

  //   rim = ORB_RIM_DARKEN * orb * smoothstep(0.75 R, R, r)
  // gives an orb an edge against sunlit ground, where its glow alone has none.
  dotColor *= 1.0 - ORB_RIM_DARKEN * orb * smoothstep(0.75 * radius, radius, r);

  if (orb > 0.01 && uHasBadges > 0.5) {
    // The count cross-fades while an orb turns into another (vOrb.w follows the path).
    float ink = mix(badgeInk(vOrb.y, corner, radius), badgeInk(vOrb.z, corner, radius), vOrb.w);
    dotColor = mix(dotColor, BADGE_INK, ink * orb);
  }

  //   shadow = SHADOW_OPACITY * (1 - smoothstep(0, width, edge))
  // reaching SHADOW_WIDTH past a pin's shape, out to ORB_SHADOW_RADIUS for an orb.
  float shadowWidth = mix(SHADOW_WIDTH, ORB_SHADOW_RADIUS - ORB_CORE_RADIUS, orb);
  float shadow = SHADOW_OPACITY * (1.0 - smoothstep(0.0, shadowWidth, edge));

  // Premultiplied, blended with (ONE, ONE_MINUS_SRC_ALPHA), so one draw does
  // three things: the dot (alpha 1) covers the ground, the shadow ring (alpha
  // SHADOW_OPACITY, no colour) darkens it, and the halo (alpha 0) adds light.
  vec3 color = dotColor * core + vColor * halo * (1.0 - core);
  float coverage = core + shadow * (1.0 - core);

  if (orb > 0.01) {
    // The orb's mark: its main category's shape, outlined in the badge ink so
    // it parts from the disc of the same colour. In pixels, like the core:
    //   mark = clamp(−d + 0.5, 0, 1),  outline = clamp(OUTLINE − d + 0.5, 0, 1)
    float markPx = shapeDistance((corner - MARK_CENTRE) / MARK_RADIUS, shape) * MARK_RADIUS * halfPx;
    float outline = orb * clamp(MARK_OUTLINE_PX * uPixelRatio - markPx + 0.5, 0.0, 1.0);
    float mark = orb * clamp(0.5 - markPx, 0.0, 1.0);
    color = mix(mix(color, BADGE_INK, outline), vColor, mark);
    coverage = mix(coverage, 1.0, outline);
  }

  // The selection ring, antialiased in pixels like the core, clear of the
  // farthest point of any shape (or of an orb's mark):
  //   ring = clamp(width / 2 − |r · halfPx − (reach · halfPx + gap)| + 0.5, 0, 1)
  // It covers what is under it, so it reads on bright ground and dark.
  float ringPx = mix(PIN_REACH, ORB_REACH, orb) * halfPx + RING_GAP_PX * uPixelRatio;
  float ring = vSelected * clamp(0.5 * RING_WIDTH_PX * uPixelRatio - abs(r * halfPx - ringPx) + 0.5, 0.0, 1.0);
  color = mix(color, RING_COLOR, ring);
  coverage = mix(coverage, 1.0, ring);
  gl_FragColor = vec4(color, coverage) * vAlpha;

  // See EARTH_FRAG for both includes.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
