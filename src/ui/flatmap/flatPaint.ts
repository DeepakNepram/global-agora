import {
  CATEGORY_SHAPES,
  shapePath,
  vec3ToLatLon,
  type ClusterLayout,
  type NewsCategory,
  type ShapeKind,
} from '@/core';
import { CATEGORY_HUES } from '@/globe';

/**
 * The flat map's paint (Prompt 5.1): shapes, colours and anchors, each
 * cached, because a pan redraws every visible pin on every frame.
 */

const paths = new Map<ShapeKind, Path2D>();
/** Each shape at equal-area radius 1, drawn under a scaling transform. */
export function shape(category: NewsCategory): Path2D {
  const kind = CATEGORY_SHAPES[category];
  let path = paths.get(kind);
  if (!path) {
    path = new Path2D(shapePath(kind));
    paths.set(kind, path);
  }
  return path;
}

/** Freshness brightness in steps this fine: far below what an eye tells apart. */
const GAIN_STEPS = 64;
const colors = new Map<string, string>();
/** The category's hue at `gain` (freshness brightness), as CSS; cached, a pan redraws thousands. */
export function color(category: NewsCategory, gain: number): string {
  const step = Math.round(gain * GAIN_STEPS);
  const key = `${category}:${step}`;
  let css = colors.get(key);
  if (!css) {
    const hex = CATEGORY_HUES[category];
    const channel = (shift: number): number =>
      Math.round((((hex >> shift) & 255) * step) / GAIN_STEPS);
    css = `rgb(${channel(16)} ${channel(8)} ${channel(0)})`;
    colors.set(key, css);
  }
  return css;
}

const places = new WeakMap<ClusterLayout, Float64Array>();
/** Each row's anchor as latitude and longitude, worked out once per layout, not per frame. */
export function anchorsOf(layout: ClusterLayout): Float64Array {
  let latLon = places.get(layout);
  if (!latLon) {
    latLon = new Float64Array(layout.count * 2);
    for (let row = 0; row < layout.count; row++) {
      const at = vec3ToLatLon({
        x: layout.anchors[row * 3] ?? 0,
        y: layout.anchors[row * 3 + 1] ?? 0,
        z: layout.anchors[row * 3 + 2] ?? 0,
      });
      latLon[row * 2] = at.lat;
      latLon[row * 2 + 1] = at.lon;
    }
    places.set(layout, latLon);
  }
  return latLon;
}

/** Fills the category's shape at (x, y), equal-area radius r (CSS px), with a dark edge. */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  ratio: number,
  category: NewsCategory,
  x: number,
  y: number,
  r: number,
  fill: string,
  edge: string,
  edgePx: number,
): void {
  const path = shape(category);
  ctx.setTransform(ratio * r, 0, 0, ratio * r, ratio * x, ratio * y);
  // The stroke straddles the outline and the fill covers its inner half.
  ctx.lineWidth = (2 * edgePx) / r;
  ctx.strokeStyle = edge;
  ctx.stroke(path);
  ctx.fillStyle = fill;
  ctx.fill(path);
}

export function circle(
  ctx: CanvasRenderingContext2D,
  ratio: number,
  x: number,
  y: number,
  r: number,
): void {
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
