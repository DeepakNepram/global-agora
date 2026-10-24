import {
  CLUSTER_ROLE,
  vec3ToLatLon,
  type ClusterLayout,
  type LatLon,
  type NodeBuffer,
} from '@/core';

import { petalOffset, type Offset } from './bloom';
import { ORB_CORE_RADIUS, PIN_HALF_SIZE_CSS_PX, orbScaleFor } from './pinStyle';

/**
 * Which pin is under a tap, on the CPU: the GPU knows where it drew each pin
 * but cannot say so without a read-back that would stall a frame. A tap is
 * rare, so projecting the last layout's rows (about 0.2 ms for 3,000) is
 * cheaper than any per-frame picking pass.
 *
 * Rows are picked where the layout puts them, not where a spring has them
 * mid-flight: a tap during a 0.5 s bloom picks where things are going.
 */

/** Half of a 44 px touch target (WCAG 2.5.5, Apple's HIG): pins are 5 px dots. */
export const PICK_RADIUS_CSS_PX = 22;

/** Enter on the focused globe looks this far from the centre of the view. */
export const ACTIVATE_RADIUS_CSS_PX = 48;

/**
 * A pin the filters dim still answers a tap, but one they show wins a near
 * tie: its distance counts for less by this factor.
 */
export const DIMMED_PICK_PENALTY = 1.6;

export type PinPick =
  | { readonly kind: 'story'; readonly row: number; readonly id: number }
  | {
      readonly kind: 'cluster';
      readonly row: number;
      readonly count: number;
      /** Where the orb sits. */
      readonly at: LatLon;
      /** The level the orb was drawn at. */
      readonly level: number;
    };

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Projects an Earth-fixed unit-sphere point to CSS pixels (y down) into
 * `out`. Returns false when the point is not drawn there: behind the globe,
 * or fading out at the limb.
 */
export type ProjectPoint = (x: number, y: number, z: number, out: ScreenPoint) => boolean;

export interface PickInput {
  readonly nodes: NodeBuffer;
  readonly layout: ClusterLayout;
  /** The displayed instant, epoch seconds: pins not yet published are not drawn. */
  readonly nowSec: number;
  /** The tap, CSS pixels from the canvas's top left. */
  readonly x: number;
  readonly y: number;
  readonly radiusPx?: number;
  readonly project: ProjectPoint;
  /** Rows the filters dim (see DIMMED_PICK_PENALTY); none when absent. */
  readonly dimmed?: (row: number) => boolean;
}

/** Where a drawn row sits on screen. */
type Placement = 'pin' | 'orb' | null;

/**
 * Puts row `row` where it is drawn, in CSS pixels, into `point`: its anchor
 * projected, plus its petal offset. 'orb' or 'pin' when it is drawn, null
 * when it is hidden, not yet published, or not on the visible side.
 */
function placeRow(
  input: Omit<PickInput, 'x' | 'y'>,
  row: number,
  point: ScreenPoint,
  petal: Offset,
): Placement {
  const { nodes, layout, nowSec, project } = input;
  const role = layout.roles[row];
  if (role === CLUSTER_ROLE.hidden || role === undefined) return null;
  const isOrb = role === CLUSTER_ROLE.orb;
  // Orbs are never time-gated; a pin is invisible until its story is published.
  if (!isOrb && nodes.epochSec + (nodes.publishedSec[row] ?? 0) > nowSec) return null;
  const ax = layout.anchors[row * 3] ?? 0;
  const ay = layout.anchors[row * 3 + 1] ?? 0;
  const az = layout.anchors[row * 3 + 2] ?? 0;
  if (!project(ax, ay, az, point)) return null;
  if (role === CLUSTER_ROLE.petal) {
    // Petal offsets are CSS pixels with y up; the screen's y runs down.
    petalOffset(layout.petals[row] ?? 0, undefined, petal);
    point.x += petal.x;
    point.y -= petal.y;
  }
  return isOrb ? 'orb' : 'pin';
}

function rowsOf(input: Omit<PickInput, 'x' | 'y'>): number {
  return Math.min(input.nodes.count, input.layout.count);
}

function orbAt(layout: ClusterLayout, row: number): LatLon {
  return vec3ToLatLon({
    x: layout.anchors[row * 3] ?? 0,
    y: layout.anchors[row * 3 + 1] ?? 0,
    z: layout.anchors[row * 3 + 2] ?? 0,
  });
}

/**
 * The drawn pin or orb nearest the tap within reach, or null. "Nearest" is
 * measured against each target's own radius, so a pin right under the finger
 * beats the edge of a large orb behind it.
 */
export function pickPin(input: PickInput): PinPick | null {
  const { nodes, layout, x, y } = input;
  const radius = input.radiusPx ?? PICK_RADIUS_CSS_PX;
  const point: ScreenPoint = { x: 0, y: 0 };
  const petal: Offset = { x: 0, y: 0 };
  let best = -1;
  let bestScore = Infinity;

  for (let row = 0; row < rowsOf(input); row++) {
    const placed = placeRow(input, row, point, petal);
    if (placed === null) continue;
    const reach =
      placed === 'orb'
        ? Math.max(
            radius,
            orbScaleFor(layout.counts[row] ?? 1) * PIN_HALF_SIZE_CSS_PX * ORB_CORE_RADIUS,
          )
        : radius;
    const distance = Math.hypot(point.x - x, point.y - y) / reach;
    if (distance > 1) continue;
    const score = input.dimmed?.(row) === true ? distance * DIMMED_PICK_PENALTY : distance;
    if (score < bestScore) {
      best = row;
      bestScore = score;
    }
  }

  if (best < 0) return null;
  if (layout.roles[best] !== CLUSTER_ROLE.orb) {
    return { kind: 'story', row: best, id: nodes.ids[best] ?? 0 };
  }
  return {
    kind: 'cluster',
    row: best,
    count: layout.counts[best] ?? 1,
    at: orbAt(layout, best),
    level: layout.level,
  };
}

/** A pin or orb drawn on screen now, for keyboard focus (Prompt 5.1). */
export type PinTarget = PinPick & {
  /** Where it is drawn, CSS pixels from the canvas's top left. */
  readonly x: number;
  readonly y: number;
  /** NEWS_CATEGORIES index: the story's, or the orb's main category. */
  readonly category: number;
  /** The filters leave it out (drawn dimmed). */
  readonly dimmed: boolean;
};

/**
 * Every pin and orb drawn now, as the last layout placed them, inside
 * `bounds` (CSS pixels): what Tab can visit. One pass over the stories, like
 * a pick; call it per key press, not per frame.
 */
export function drawnTargets(
  input: Omit<PickInput, 'x' | 'y'>,
  bounds: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  },
): PinTarget[] {
  const { nodes, layout } = input;
  const point: ScreenPoint = { x: 0, y: 0 };
  const petal: Offset = { x: 0, y: 0 };
  const targets: PinTarget[] = [];
  for (let row = 0; row < rowsOf(input); row++) {
    const placed = placeRow(input, row, point, petal);
    if (placed === null) continue;
    if (point.x < bounds.left || point.x > bounds.right) continue;
    if (point.y < bounds.top || point.y > bounds.bottom) continue;
    const shared = {
      row,
      x: point.x,
      y: point.y,
      category: layout.categories[row] ?? 0,
      dimmed: input.dimmed?.(row) === true,
    };
    targets.push(
      placed === 'orb'
        ? {
            ...shared,
            kind: 'cluster',
            count: layout.counts[row] ?? 1,
            at: orbAt(layout, row),
            level: layout.level,
          }
        : { ...shared, kind: 'story', id: nodes.ids[row] ?? 0 },
    );
  }
  return targets;
}

/** Where row `row` is drawn now (CSS pixels), or null when it is not drawn. */
export function locateRow(input: Omit<PickInput, 'x' | 'y'>, row: number): ScreenPoint | null {
  if (row < 0 || row >= rowsOf(input)) return null;
  const point: ScreenPoint = { x: 0, y: 0 };
  return placeRow(input, row, point, { x: 0, y: 0 }) === null ? null : point;
}
