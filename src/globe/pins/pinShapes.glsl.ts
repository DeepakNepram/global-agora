/**
 * The category shapes on the GPU (Prompt 5.1): signed distances for every
 * shape in src/core/categoryShapes.ts, generated from the same numbers, so a
 * pin on the globe, on the flat map and in a label is the same outline. The
 * CPU mirror there (shapeDistance) is what the tests check the maths against.
 */

import {
  CATEGORY_SHAPES,
  NEWS_CATEGORIES,
  PLUS_ARMS,
  RADIAL_SHAPES,
  SHAPE_KINDS,
  shapeReach,
  type ShapeKind,
} from '@/core';

import { glslFloat } from '../hdr';
import { CORE_RADIUS, ORB_CORE_RADIUS } from './pinStyle';

/** The farthest any pin shape reaches from its centre, in quad half-sizes: where its ring starts. */
export const PIN_REACH = CORE_RADIUS * Math.max(...SHAPE_KINDS.map(shapeReach));

/**
 * An orb's category mark: its main category's shape at this equal-area radius
 * (quad half-sizes), centred just outside the disc's rim, up and to the
 * right, clear of a two-digit count. At the smallest orb (scale 2) that is a
 * 3.6 CSS px radius, an 8 px shape.
 */
export const ORB_MARK_RADIUS = 0.2;
const ORB_MARK_DISTANCE = ORB_CORE_RADIUS + 0.05;
export const ORB_MARK_CENTRE: readonly [number, number] = [
  ORB_MARK_DISTANCE * Math.SQRT1_2,
  ORB_MARK_DISTANCE * Math.SQRT1_2,
];
/** The mark's dark outline, CSS px: it parts the mark from the disc of the same colour. */
export const ORB_MARK_OUTLINE_CSS_PX = 1.25;
/** How far an orb and its mark reach, in quad half-sizes: where an orb's ring starts. */
export const ORB_REACH = Math.max(
  ORB_CORE_RADIUS,
  Math.hypot(...ORB_MARK_CENTRE) + ORB_MARK_RADIUS * Math.max(...SHAPE_KINDS.map(shapeReach)),
);

function distanceCall(kind: ShapeKind): string {
  if (kind === 'circle') return 'length(p) - 1.0';
  if (kind === 'plus') return 'sdPlus(p)';
  // The plus turned 45°: (x + y, y − x) / √2.
  if (kind === 'cross') return 'sdPlus(vec2(p.x + p.y, p.y - p.x) * 0.70710678)';
  const shape = RADIAL_SHAPES[kind];
  if (!shape) throw new Error(`no geometry for shape ${kind}`);
  return `sdRadial(p, ${[shape.points, shape.outer, shape.inner, shape.phase].map(glslFloat).join(', ')})`;
}

/**
 * Fragment-side helpers. Distances are in the shape's equal-area units
 * (scale the point down by the shape's radius, the distance back up).
 */
export const PIN_SHAPES_FRAG = /* glsl */ `
// A star or regular polygon (categoryShapes.ts RadialShape). The point is
// folded into the wedge between an outer vertex A, on the x axis, and the
// next inner vertex B, π/n further round:
//   angle = min(s, 2π/n − s),  s = mod(atan(x, y) − phase, 2π/n)
// then measured to segment AB; the origin's side of AB is inside (negative).
// The epsilon keeps atan defined at the exact centre.
float sdRadial(vec2 p, float n, float outer, float inner, float phase) {
  float wedge = 3.14159265 / n;
  float sector = mod(atan(p.x, p.y + 1e-6) - phase, 2.0 * wedge);
  float angle = min(sector, 2.0 * wedge - sector);
  vec2 q = length(p) * vec2(cos(angle), sin(angle));
  vec2 a = vec2(outer, 0.0);
  vec2 e = inner * vec2(cos(wedge), sin(wedge)) - a;
  float h = clamp(dot(q - a, e) / dot(e, e), 0.0, 1.0);
  float d = length(q - a - h * e);
  return e.x * q.y - e.y * (q.x - a.x) > 0.0 ? -d : d;
}

// The plus (iq's cross): fold into one arm, then distance to the arm's box.
float sdPlus(vec2 p) {
  p = abs(p);
  p = p.y > p.x ? p.yx : p.xy;
  vec2 q = p - vec2(${glslFloat(PLUS_ARMS.length)}, ${glslFloat(PLUS_ARMS.width)});
  float k = max(q.x, q.y);
  vec2 w = k > 0.0 ? q : vec2(${glslFloat(PLUS_ARMS.width)} - p.x, -k);
  return sign(k) * length(max(w, 0.0));
}

// SHAPE_KINDS in order; shape is the index, from the vertex shader.
float shapeDistance(vec2 p, float shape) {
${SHAPE_KINDS.map((kind, i) =>
  i < SHAPE_KINDS.length - 1
    ? `  if (shape < ${glslFloat(i + 0.5)}) return ${distanceCall(kind)};`
    : `  return ${distanceCall(kind)};`,
).join('\n')}
}
`;

/** Vertex-side: a category's shape index (CATEGORY_SHAPES), for the varying vShape. */
export const PIN_SHAPE_OF_VERT = /* glsl */ `
float shapeOf(int category) {
${NEWS_CATEGORIES.map(
  (category, i) =>
    `  if (category == ${i}) return ${glslFloat(SHAPE_KINDS.indexOf(CATEGORY_SHAPES[category]))};`,
).join('\n')}
  return 0.0;
}
`;
