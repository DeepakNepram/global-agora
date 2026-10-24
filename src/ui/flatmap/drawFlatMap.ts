import {
  CLUSTER_ROLE,
  categoryAt,
  flatProject,
  textureSpans,
  type ClusterLayout,
  type FlatPoint,
  type FlatSize,
  type FlatView,
  type NewsCategory,
  type NodeBuffer,
} from '@/core';
import {
  BADGE_INK,
  CORE_RADIUS,
  FILTERED_ALPHA,
  FILTERED_SCALE,
  ORB_CORE_RADIUS,
  ORB_MARK_CENTRE,
  ORB_MARK_OUTLINE_CSS_PX,
  ORB_MARK_RADIUS,
  ORB_REACH,
  PIN_HALF_SIZE_CSS_PX,
  PIN_REACH,
  SELECTION_RING_GAP_CSS_PX,
  SELECTION_RING_WIDTH_CSS_PX,
  badgeText,
  colorGainFor,
  freshnessFor,
  orbScaleFor,
  petalOffset,
  scaleForHeat,
} from '@/globe';

import { anchorsOf, circle, color, drawShape } from './flatPaint';

/** Everything one frame of the flat map draws. */
export interface FlatScene {
  readonly view: FlatView;
  readonly size: FlatSize;
  /** Device pixels per CSS pixel. */
  readonly ratio: number;
  readonly texture: HTMLImageElement | null;
  readonly nodes: NodeBuffer | null;
  readonly layout: ClusterLayout | null;
  /** The displayed instant, epoch seconds: pins not yet published are not drawn. */
  readonly nowSec: number;
  /** Rows the filters leave out, drawn faint and small as on the globe. */
  readonly dimmed: (row: number) => boolean;
  /** The row wearing the selection ring (the story, or the orb holding it); −1 for none. */
  readonly ringed: number;
  readonly fontFamily: string;
}

/** Before the texture arrives, and beyond nothing: the admin map's sea colour. */
const SEA = '#0b1a2b';
/** Darkens the day texture a little so the pins, not the ground, carry the eye. */
const GROUND_DIM = 'rgb(5 7 13 / 0.3)';
/** A pin's dark edge: the globe's shadow ring, for bright ground. */
const EDGE = 'rgb(5 7 13 / 0.65)';
const EDGE_CSS_PX = 1.5;
/** The orb's colour gain on the globe (ORB_COLOR_GAIN), and its rim. */
const ORB_GAIN = 0.9;
/** Pixels beyond the frame a pin may sit and still be drawn (its shape reaches in). */
const CULL_PX = 40;
const INK = `rgb(${BADGE_INK.map((c) => Math.round(c * 255)).join(' ')})`;
const RING = 'rgb(235 242 255)';

/** Where row `row` is drawn now (its anchor, plus its petal offset), into `out`. */
export function placeFlatRow(
  layout: ClusterLayout,
  view: FlatView,
  size: FlatSize,
  row: number,
  out: FlatPoint,
): FlatPoint {
  const latLon = anchorsOf(layout);
  flatProject(view, size, latLon[row * 2] ?? 0, latLon[row * 2 + 1] ?? 0, out);
  if (layout.roles[row] === CLUSTER_ROLE.petal) {
    // Petal offsets are CSS pixels with y up; the screen's y runs down.
    const petal = petalOffset(layout.petals[row] ?? 0);
    out.x += petal.x;
    out.y -= petal.y;
  }
  return out;
}

/**
 * Draws the flat map (Prompt 5.1): the day texture, then every pin as its
 * category's shape (size from heat, brightness from freshness, faint where
 * the filters leave it out), then the orbs with their count and mark, then
 * the selection ring. Nothing pulses and nothing glows: under reduced
 * motion the map is still unless the reader moves it.
 */
export function drawFlatMap(ctx: CanvasRenderingContext2D, scene: FlatScene): void {
  const { view, size, ratio, texture, nodes, layout, nowSec } = scene;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = SEA;
  ctx.fillRect(0, 0, size.width * ratio, size.height * ratio);
  if (texture) {
    ctx.imageSmoothingQuality = 'high';
    const tex = { width: texture.naturalWidth, height: texture.naturalHeight };
    for (const span of textureSpans(view, size, tex)) {
      ctx.drawImage(
        texture,
        span.sx,
        span.sy,
        span.sw,
        span.sh,
        span.dx * ratio,
        0,
        span.dw * ratio,
        size.height * ratio,
      );
    }
    ctx.fillStyle = GROUND_DIM;
    ctx.fillRect(0, 0, size.width * ratio, size.height * ratio);
  }
  if (!nodes || !layout) return;

  const rows = Math.min(nodes.count, layout.count);
  const at: FlatPoint = { x: 0, y: 0 };
  const visible = (point: FlatPoint): boolean =>
    point.x > -CULL_PX &&
    point.x < size.width + CULL_PX &&
    point.y > -CULL_PX &&
    point.y < size.height + CULL_PX;

  // Pins first, orbs over them, as the globe draws its orbs larger and on top.
  const orbRows: number[] = [];
  for (const orbs of [false, true]) {
    const count = orbs ? orbRows.length : rows;
    for (let i = 0; i < count; i++) {
      const row = orbs ? (orbRows[i] ?? 0) : i;
      const role = layout.roles[row];
      if (role === undefined || role === CLUSTER_ROLE.hidden) continue;
      const isOrb = role === CLUSTER_ROLE.orb;
      if (isOrb && !orbs) {
        orbRows.push(row);
        continue;
      }
      const published = nodes.epochSec + (nodes.publishedSec[row] ?? 0);
      if (!isOrb && published > nowSec) continue;
      if (!visible(placeFlatRow(layout, view, size, row, at))) continue;
      const category = categoryAt(layout.categories[row] ?? 0);
      const dim = scene.dimmed(row);
      ctx.globalAlpha = dim ? FILTERED_ALPHA : 1;
      if (isOrb) drawOrb(ctx, scene, row, category, at);
      else {
        const half =
          PIN_HALF_SIZE_CSS_PX * scaleForHeat(nodes.heat[row] ?? 0) * (dim ? FILTERED_SCALE : 1);
        const gain = colorGainFor(freshnessFor(nowSec - published));
        drawShape(
          ctx,
          ratio,
          category,
          at.x,
          at.y,
          half * CORE_RADIUS,
          color(category, gain),
          EDGE,
          EDGE_CSS_PX,
        );
      }
    }
  }
  ctx.globalAlpha = 1;
  drawRing(ctx, scene, at);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawOrb(
  ctx: CanvasRenderingContext2D,
  scene: FlatScene,
  row: number,
  category: NewsCategory,
  at: FlatPoint,
): void {
  const { ratio, layout } = scene;
  const count = layout?.counts[row] ?? 1;
  const half = PIN_HALF_SIZE_CSS_PX * orbScaleFor(count);
  const radius = half * ORB_CORE_RADIUS;
  circle(ctx, ratio, at.x, at.y, radius);
  ctx.fillStyle = color(category, ORB_GAIN);
  ctx.fill();
  ctx.lineWidth = EDGE_CSS_PX;
  ctx.strokeStyle = EDGE;
  ctx.stroke();

  // The count, as the globe's badge writes it (badgeGlyphs.ts).
  const text = badgeText(count);
  ctx.font = `600 ${Math.round(radius * Math.min(1.1, 2.2 / Math.max(1, text.length)))}px ${scene.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  ctx.fillText(text, at.x, at.y + radius * 0.06);

  // The main category's mark on the rim, up and to the right (pinShapes.glsl.ts).
  const [mx, my] = ORB_MARK_CENTRE;
  drawShape(
    ctx,
    ratio,
    category,
    at.x + mx * half,
    at.y - my * half,
    ORB_MARK_RADIUS * half,
    color(category, 1),
    INK,
    ORB_MARK_OUTLINE_CSS_PX,
  );
}

function drawRing(ctx: CanvasRenderingContext2D, scene: FlatScene, at: FlatPoint): void {
  const { nodes, layout, view, size, ratio, ringed } = scene;
  if (!nodes || !layout || ringed < 0) return;
  const role = layout.roles[ringed];
  if (role === undefined || role === CLUSTER_ROLE.hidden) return;
  placeFlatRow(layout, view, size, ringed, at);
  const isOrb = role === CLUSTER_ROLE.orb;
  const half =
    PIN_HALF_SIZE_CSS_PX *
    (isOrb ? orbScaleFor(layout.counts[ringed] ?? 1) : scaleForHeat(nodes.heat[ringed] ?? 0));
  circle(
    ctx,
    ratio,
    at.x,
    at.y,
    (isOrb ? ORB_REACH : PIN_REACH) * half + SELECTION_RING_GAP_CSS_PX,
  );
  ctx.lineWidth = SELECTION_RING_WIDTH_CSS_PX;
  ctx.strokeStyle = RING;
  ctx.stroke();
}
