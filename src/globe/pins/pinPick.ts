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
}

/**
 * The drawn pin or orb nearest the tap within reach, or null. "Nearest" is
 * measured against each target's own radius, so a pin right under the finger
 * beats the edge of a large orb behind it.
 */
export function pickPin(input: PickInput): PinPick | null {
  const { nodes, layout, nowSec, x, y, project } = input;
  const radius = input.radiusPx ?? PICK_RADIUS_CSS_PX;
  const rows = Math.min(nodes.count, layout.count);
  const point: ScreenPoint = { x: 0, y: 0 };
  const petal: Offset = { x: 0, y: 0 };
  let best = -1;
  let bestScore = Infinity;

  for (let row = 0; row < rows; row++) {
    const role = layout.roles[row];
    if (role === CLUSTER_ROLE.hidden || role === undefined) continue;
    const isOrb = role === CLUSTER_ROLE.orb;
    // Orbs are never time-gated; a pin is invisible until its story is published.
    if (!isOrb && nodes.epochSec + (nodes.publishedSec[row] ?? 0) > nowSec) continue;
    const ax = layout.anchors[row * 3] ?? 0;
    const ay = layout.anchors[row * 3 + 1] ?? 0;
    const az = layout.anchors[row * 3 + 2] ?? 0;
    if (!project(ax, ay, az, point)) continue;
    if (role === CLUSTER_ROLE.petal) {
      // Petal offsets are CSS pixels with y up; the screen's y runs down.
      petalOffset(layout.petals[row] ?? 0, undefined, petal);
      point.x += petal.x;
      point.y -= petal.y;
    }
    const reach = isOrb
      ? Math.max(
          radius,
          orbScaleFor(layout.counts[row] ?? 1) * PIN_HALF_SIZE_CSS_PX * ORB_CORE_RADIUS,
        )
      : radius;
    const score = Math.hypot(point.x - x, point.y - y) / reach;
    if (score <= 1 && score < bestScore) {
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
    at: vec3ToLatLon({
      x: layout.anchors[best * 3] ?? 0,
      y: layout.anchors[best * 3 + 1] ?? 0,
      z: layout.anchors[best * 3 + 2] ?? 0,
    }),
    level: layout.level,
  };
}
