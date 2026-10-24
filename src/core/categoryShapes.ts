/**
 * Each news category's shape (Prompt 5.1): colour is never the only cue, so a
 * pin's category reads from its outline too, on the globe (pinFragment.glsl),
 * the flat map (Path2D) and every label (SVG). One geometry feeds all three.
 *
 * Sizes are in units of the circle of equal area, so no shape looks heavier
 * than another at the same pin size. Coordinates are y up; shapePath flips
 * them for SVG and canvas.
 */

import type { NewsCategory } from './nodeBuffer';

/** Append only: the shader indexes shapes by position. */
export const SHAPE_KINDS = [
  'circle',
  'triangle',
  'square',
  'diamond',
  'cross',
  'triangleDown',
  'star',
  'plus',
] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const CATEGORY_SHAPES: Readonly<Record<NewsCategory, ShapeKind>> = {
  world: 'circle',
  conflict: 'triangle',
  politics: 'square',
  business: 'diamond',
  // A hexagon read as a circle at pin size; × is the usual eighth marker.
  science: 'cross',
  climate: 'triangleDown',
  tech: 'star',
  health: 'plus',
};

/**
 * A regular polygon or star: `points` outer vertices at radius `outer`, the
 * first `phase` radians clockwise from straight up, and an inner vertex at
 * radius `inner` midway between each pair (outer · cos(π / points) for a
 * plain polygon, whose "inner vertex" is then the middle of an edge).
 */
export interface RadialShape {
  readonly points: number;
  readonly outer: number;
  readonly inner: number;
  readonly phase: number;
}

/**
 * Outer radius giving area π, from the polygon's area as 2n triangles
 * between the centre and each pair of neighbouring vertices:
 *   area = n · outer · inner · sin(π / n),  inner = k · outer
 *   outer = √(π / (n · k · sin(π / n)))
 */
function radial(points: number, innerRatio: number, phase: number): RadialShape {
  const outer = Math.sqrt(Math.PI / (points * innerRatio * Math.sin(Math.PI / points)));
  return { points, outer, inner: outer * innerRatio, phase };
}

function polygon(points: number, phase: number): RadialShape {
  return radial(points, Math.cos(Math.PI / points), phase);
}

/** A fat star (inner radius half the outer) still reads as a star at 8 px. */
const STAR_INNER_RATIO = 0.5;

export const RADIAL_SHAPES: Readonly<Partial<Record<ShapeKind, RadialShape>>> = {
  triangle: polygon(3, 0),
  square: polygon(4, Math.PI / 4),
  diamond: polygon(4, 0),
  triangleDown: polygon(3, Math.PI),
  star: radial(5, STAR_INNER_RATIO, 0),
};

/**
 * The plus: two bars of half-length `length` and half-width `width`, with
 * width = PLUS_WIDTH_RATIO · length, so area = 8·L·w − 4·w² = π. The cross
 * is the same plus turned 45°.
 */
const PLUS_WIDTH_RATIO = 0.36;
export const PLUS_ARMS: { readonly length: number; readonly width: number } = (() => {
  const k = PLUS_WIDTH_RATIO;
  const length = Math.sqrt(Math.PI / (8 * k - 4 * k * k));
  return { length, width: length * k };
})();

type Point = readonly [x: number, y: number];

function plusOutline(): Point[] {
  const { length: l, width: w } = PLUS_ARMS;
  return [
    [w, l],
    [w, w],
    [l, w],
    [l, -w],
    [w, -w],
    [w, -l],
    [-w, -l],
    [-w, -w],
    [-l, -w],
    [-l, w],
    [-w, w],
    [-w, l],
  ];
}

/** Turns a point 45°. The plus is symmetric under reflection, so this turn and its inverse draw the same cross. */
function turn45([x, y]: Point): Point {
  return [(x + y) * Math.SQRT1_2, (y - x) * Math.SQRT1_2];
}

/** The shape's outline, y up, in equal-area units; null for the circle. */
export function shapeOutline(kind: ShapeKind): readonly Point[] | null {
  if (kind === 'circle') return null;
  if (kind === 'plus') return plusOutline();
  if (kind === 'cross') return plusOutline().map(turn45);
  const shape = RADIAL_SHAPES[kind];
  if (!shape) return null;
  const outline: Point[] = [];
  const step = Math.PI / shape.points;
  for (let i = 0; i < shape.points * 2; i++) {
    const radius = i % 2 === 0 ? shape.outer : shape.inner;
    // Clockwise from up: x = r·sin(θ), y = r·cos(θ).
    const angle = shape.phase + i * step;
    // A plain polygon's inner points sit on its edges; leaving them out keeps the path minimal.
    if (i % 2 === 1 && kind !== 'star') continue;
    outline.push([radius * Math.sin(angle), radius * Math.cos(angle)]);
  }
  return outline;
}

/** Six decimals: far below a pixel at any size a label draws. */
function fixed(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

/**
 * An SVG path (y down, as SVG and canvas draw) of the shape at `scale` times
 * its equal-area size, centred on the origin. Path2D takes the same string.
 */
export function shapePath(kind: ShapeKind, scale = 1): string {
  const outline = shapeOutline(kind);
  if (!outline) {
    const r = fixed(scale);
    return `M${r} 0A${r} ${r} 0 1 1 -${r} 0A${r} ${r} 0 1 1 ${r} 0Z`;
  }
  return (
    outline
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fixed(x * scale)} ${fixed(-y * scale)}`)
      .join('') + 'Z'
  );
}

/** How far the shape reaches from its centre, in equal-area units: room for a ring around it. */
export function shapeReach(kind: ShapeKind): number {
  const outline = shapeOutline(kind);
  if (!outline) return 1;
  return Math.max(...outline.map(([x, y]) => Math.hypot(x, y)));
}

/** iq's cross: fold into one arm, then the distance to the arm's box. */
function plusDistance(x: number, y: number): number {
  let px = Math.abs(x);
  let py = Math.abs(y);
  if (py > px) [px, py] = [py, px];
  const qx = px - PLUS_ARMS.length;
  const qy = py - PLUS_ARMS.width;
  const k = Math.max(qx, qy);
  const [wx, wy] = k > 0 ? [qx, qy] : [PLUS_ARMS.width - px, -k];
  return Math.sign(k) * Math.hypot(Math.max(wx, 0), Math.max(wy, 0));
}

/**
 * Signed distance from (x, y) to the shape's edge, negative inside: the CPU
 * mirror of the pin shader's shapeDistance, so tests can check the GPU maths.
 * A radial shape folds the point into the wedge between an outer vertex A
 * and the next inner vertex B, then measures to segment AB.
 */
export function shapeDistance(kind: ShapeKind, x: number, y: number): number {
  if (kind === 'circle') return Math.hypot(x, y) - 1;
  if (kind === 'plus') return plusDistance(x, y);
  if (kind === 'cross') return plusDistance(...turn45([x, y]));
  const shape = RADIAL_SHAPES[kind];
  if (!shape) return Math.hypot(x, y) - 1;
  const wedge = Math.PI / shape.points;
  const turned = Math.atan2(x, y) - shape.phase;
  const inSector = turned - 2 * wedge * Math.floor(turned / (2 * wedge));
  const angle = Math.min(inSector, 2 * wedge - inSector);
  const r = Math.hypot(x, y);
  const qx = r * Math.cos(angle);
  const qy = r * Math.sin(angle);
  const ax = shape.outer;
  const bx = shape.inner * Math.cos(wedge);
  const by = shape.inner * Math.sin(wedge);
  const ex = bx - ax;
  const ey = by;
  const h = Math.min(Math.max(((qx - ax) * ex + qy * ey) / (ex * ex + ey * ey), 0), 1);
  const distance = Math.hypot(qx - ax - h * ex, qy - h * ey);
  // Inside is the origin's side of AB: the cross product's sign there is +.
  return ex * qy - ey * (qx - ax) > 0 ? -distance : distance;
}
