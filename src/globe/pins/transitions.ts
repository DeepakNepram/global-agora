import { CLUSTER_ROLE, type ClusterLayout, type NodeBuffer } from '@/core';

import { BLOOM_TWIST_RAD, petalOffset, type Offset } from './bloom';
import { createPathWriter, endAt, isAtRest, schedule } from './pathWriter';
import { LOOK, encodeLook, hiddenLook, isVisibleLook } from './pinInstances';
import {
  createDrawn,
  createEnd,
  drawnState,
  sameEnd,
  samePlace,
  type DrawnState,
  type PinEnd,
} from './pinPath';

/**
 * The transition planner: given where every slot is drawn now and what the new
 * layout wants, it writes each slot's next path and spring once, and the
 * vertex shader animates them. O(slots), no per-frame work.
 *
 * - A slot whose new resting state is one end of its current path is simply
 *   retargeted along that path. That is how zooming back out reverses a bloom
 *   along the same spiral, even halfway through.
 * - Otherwise a new path starts from where the slot is drawn now. Children
 *   emerge from their old cluster's orb; children being absorbed end hidden at
 *   their new cluster's centre; a story that left the payload fades in place.
 * - Siblings (moves out of, or into, the same slot) are staggered, hottest and
 *   innermost first, mirrored when collapsing.
 */

export interface PlanInput {
  readonly array: Float32Array;
  /** Slots in use, including ones still fading out. */
  readonly slotCount: number;
  readonly nodes: NodeBuffer;
  readonly layout: ClusterLayout;
  readonly rowSlots: Int32Array;
  /** 1 for a slot whose story was not drawn before. */
  readonly fresh: Uint8Array;
  /** Per slot: the slot drawing its group in the last layout. Updated in place. */
  readonly groupSlot: Int32Array;
  readonly departed: readonly number[];
  readonly clock: number;
  /**
   * +1 when the new layout is deeper (zoomed in, or clusters opening as the
   * time starts to move), −1 shallower (or closing), 0 the same.
   */
  readonly direction: number;
  /** Land every change at once: first layout, a new source, or reduced motion. */
  readonly instant: boolean;
}

export interface PlanResult {
  readonly moving: number;
  /** Clock time by which every spring set here has settled. */
  readonly endsAt: number;
}

/**
 * Reused between plans: a level change would otherwise allocate one object per
 * slot. Nothing keeps a reference past the plan that filled it.
 */
const drawnPool: DrawnState[] = [];

export function planTransitions(input: PlanInput): PlanResult {
  const { array, slotCount, nodes, layout, rowSlots, fresh, groupSlot, clock, direction } = input;

  // Where everything is drawn now, read before any path is rewritten: an
  // emerging child starts from its parent's position, which may change below.
  const drawn: (DrawnState | null)[] = new Array<DrawnState | null>(slotCount).fill(null);
  for (let slot = 0; slot < slotCount; slot++) {
    if (fresh[slot]) continue;
    drawn[slot] = drawnState(array, slot, clock, (drawnPool[slot] ??= createDrawn()));
  }

  const writer = createPathWriter(array, clock);
  const { setPath, record, alongPath } = writer;
  const desired = createEnd();
  const start = createEnd();
  const petal: Offset = { x: 0, y: 0 };

  for (let row = 0; row < layout.count; row++) {
    const slot = rowSlots[row] ?? -1;
    if (slot < 0) continue;
    const now = drawn[slot] ?? null;
    const role = layout.roles[row] ?? CLUSTER_ROLE.hidden;
    const groupRow = layout.groups[row] ?? -1;
    const newGroup = groupRow >= 0 ? (rowSlots[groupRow] ?? -1) : -1;
    const oldGroup = now ? (groupSlot[slot] ?? -1) : -1;
    const ax = layout.anchors[row * 3] ?? 0;
    const ay = layout.anchors[row * 3 + 1] ?? 0;
    const az = layout.anchors[row * 3 + 2] ?? 0;
    const pinLook = encodeLook(LOOK.pin, nodes.categories[row] ?? 0, nodes.heat[row] ?? 0);

    if (role === CLUSTER_ROLE.hidden) {
      if (!now) {
        endAt(desired, ax, ay, az, hiddenLook(pinLook));
        setPath(slot, desired, desired, 0, 1, 1);
        continue;
      }
      const centre = endAt(start, ax, ay, az, hiddenLook(now.look));
      const hiddenAtCentre = (end: PinEnd): boolean =>
        !isVisibleLook(end.look) && samePlace(end, centre);
      if (alongPath(slot, hiddenAtCentre, now, oldGroup, newGroup)) {
        // Back into the orb it came out of, along the same spiral.
      } else if (!isVisibleLook(now.look) && now.alpha < 0.01) {
        // Out of sight already: re-seat it silently at its new group's centre.
        setPath(slot, centre, centre, 0, 1, 1);
      } else {
        setPath(slot, centre, now, BLOOM_TWIST_RAD, 1, 0);
        record(slot, newGroup, 0, isAtRest(now));
      }
      continue;
    }

    const orbLook = encodeLook(LOOK.orb, layout.categories[row] ?? 0, layout.counts[row] ?? 1);
    const offset =
      role === CLUSTER_ROLE.petal
        ? petalOffset(layout.petals[row] ?? 0, undefined, petal)
        : undefined;
    endAt(desired, ax, ay, az, role === CLUSTER_ROLE.orb ? orbLook : pinLook, offset);

    if (!now) {
      // A new story: grows in where it belongs.
      setPath(slot, { ...desired, look: hiddenLook(desired.look) }, desired, 0, 0, 1);
      record(slot, slot, 1, true);
      continue;
    }
    if (alongPath(slot, (end) => sameEnd(end, desired), now, oldGroup, newGroup)) {
      // Out along its path again, or back along it.
    } else if (isVisibleLook(now.look)) {
      if (direction < 0) {
        setPath(slot, desired, now, BLOOM_TWIST_RAD, 1, 0);
        record(slot, newGroup, 0, isAtRest(now));
      } else {
        setPath(slot, now, desired, direction > 0 ? BLOOM_TWIST_RAD : 0, 0, 1);
        record(slot, direction > 0 ? oldGroup : slot, 1, isAtRest(now));
      }
    } else {
      // Emerging: out of the orb that drew it, or in place if nothing did.
      const parentNow = oldGroup >= 0 ? (drawn[oldGroup] ?? null) : null;
      const fromParent = parentNow !== null && isVisibleLook(parentNow.look);
      const origin = fromParent ? parentNow : desired;
      endAt(start, origin.x, origin.y, origin.z, hiddenLook(desired.look), {
        x: origin.ox,
        y: origin.oy,
      });
      setPath(slot, start, desired, fromParent ? BLOOM_TWIST_RAD : 0, 0, 1);
      record(slot, fromParent ? oldGroup : slot, 1, true);
    }
  }

  for (const slot of input.departed) {
    const now = drawn[slot] ?? null;
    groupSlot[slot] = -1;
    if (!now || now.alpha < 0.01) continue;
    endAt(start, now.x, now.y, now.z, hiddenLook(now.look), { x: now.ox, y: now.oy });
    setPath(slot, start, now, 0, 1, 0);
    record(slot, slot, 0, isAtRest(now));
  }

  for (let row = 0; row < layout.count; row++) {
    const slot = rowSlots[row] ?? -1;
    const groupRow = layout.groups[row] ?? -1;
    if (slot >= 0) groupSlot[slot] = groupRow >= 0 ? (rowSlots[groupRow] ?? -1) : -1;
  }

  return {
    moving: writer.moves.length,
    endsAt: schedule(array, writer.moves, clock, input.instant),
  };
}
