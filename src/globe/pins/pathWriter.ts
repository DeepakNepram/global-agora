import { BLOOM_SETTLE_SECONDS, staggerDelay, type Offset } from './bloom';
import { LOOK, PIN_OFFSET, PIN_STRIDE, lookKind, lookValue } from './pinInstances';
import { createEnd, readEnd, writeEnd, type DrawnState, type PinEnd } from './pinPath';

/**
 * The planner's pen: writes a slot's path and spring into the instance array
 * and remembers every move it starts, so the siblings can then be staggered
 * together. See transitions.ts for when each is used.
 */

export interface Move {
  readonly slot: number;
  /** Siblings share this: the slot they leave from or collapse into. */
  readonly parent: number;
  readonly collapsing: boolean;
  /** Only a move that starts from rest waits its turn; one already in flight turns at once. */
  readonly fromRest: boolean;
  /** Distance of the child end from its centre, px: petals leave innermost first. */
  readonly radius: number;
  /** Orbs before pins, bigger clusters and hotter stories first. */
  readonly size: number;
}

export function isAtRest(state: DrawnState | null): boolean {
  return !state || (Math.abs(state.v) < 1e-3 && (state.u < 1e-3 || state.u > 1 - 1e-3));
}

export function endAt(
  out: PinEnd,
  x: number,
  y: number,
  z: number,
  look: number,
  offset?: Offset,
): PinEnd {
  out.x = x;
  out.y = y;
  out.z = z;
  out.look = look;
  out.ox = offset?.x ?? 0;
  out.oy = offset?.y ?? 0;
  return out;
}

export interface PathWriter {
  readonly moves: Move[];
  /** A new path from `from` (inner) to `to` (outer), starting at progress u0. */
  setPath(slot: number, from: PinEnd, to: PinEnd, twist: number, u0: number, target: number): void;
  record(slot: number, parent: number, target: number, fromRest: boolean): void;
  /** Along the current path from wherever the slot is on it. Already heading there: nothing to do. */
  retarget(slot: number, target: number, now: DrawnState, parent: number): void;
  /**
   * If either end of the slot's path is where it should rest, moves it along
   * that path and returns true. The end it is already heading to is checked
   * first, so a path whose ends coincide is left alone.
   */
  alongPath(
    slot: number,
    rest: (end: PinEnd) => boolean,
    now: DrawnState,
    outward: number,
    inward: number,
  ): boolean;
}

export function createPathWriter(array: Float32Array, clock: number): PathWriter {
  const moves: Move[] = [];
  const inner = createEnd();
  const outer = createEnd();

  const record: PathWriter['record'] = (slot, parent, target, fromRest) => {
    readEnd(array, slot, 'outer', outer);
    const kind = lookKind(outer.look);
    const orb = kind === LOOK.orb || kind === LOOK.hiddenOrb;
    moves.push({
      slot,
      parent: parent >= 0 ? parent : slot,
      collapsing: target === 0,
      fromRest,
      radius: Math.hypot(outer.ox, outer.oy),
      size: orb ? 256 + lookValue(outer.look) : lookValue(outer.look),
    });
  };

  const retarget: PathWriter['retarget'] = (slot, target, now, parent) => {
    const at = slot * PIN_STRIDE;
    if (array[at + PIN_OFFSET.target] === target) return;
    array[at + PIN_OFFSET.u0] = now.u;
    array[at + PIN_OFFSET.v0] = now.v;
    array[at + PIN_OFFSET.t0] = clock;
    array[at + PIN_OFFSET.target] = target;
    record(slot, parent, target, isAtRest(now));
  };

  return {
    moves,
    record,
    retarget,

    setPath(slot, from, to, twist, u0, target) {
      const at = slot * PIN_STRIDE;
      writeEnd(array, slot, 'inner', from);
      writeEnd(array, slot, 'outer', to);
      array[at + PIN_OFFSET.twist] = twist;
      array[at + PIN_OFFSET.u0] = u0;
      array[at + PIN_OFFSET.v0] = 0;
      array[at + PIN_OFFSET.t0] = clock;
      array[at + PIN_OFFSET.target] = target;
    },

    alongPath(slot, rest, now, outward, inward) {
      readEnd(array, slot, 'inner', inner);
      readEnd(array, slot, 'outer', outer);
      const heading = (array[slot * PIN_STRIDE + PIN_OFFSET.target] ?? 0) >= 0.5 ? 1 : 0;
      for (const target of heading === 1 ? [1, 0] : [0, 1]) {
        if (!rest(target === 1 ? outer : inner)) continue;
        retarget(slot, target, now, target === 1 ? outward : inward);
        return true;
      }
      return false;
    },
  };
}

/**
 * Staggers each sibling group and returns when the last spring settles; with
 * `instant`, lands every move where it is heading instead.
 */
export function schedule(
  array: Float32Array,
  moves: readonly Move[],
  clock: number,
  instant: boolean,
): number {
  if (instant) {
    for (const { slot } of moves) {
      const at = slot * PIN_STRIDE;
      array[at + PIN_OFFSET.u0] = array[at + PIN_OFFSET.target] ?? 1;
      array[at + PIN_OFFSET.v0] = 0;
      array[at + PIN_OFFSET.t0] = clock;
    }
    return clock;
  }
  const groups = new Map<number, Move[]>();
  for (const move of moves) {
    const siblings = groups.get(move.parent);
    if (siblings) siblings.push(move);
    else groups.set(move.parent, [move]);
  }
  let endsAt = clock;
  for (const siblings of groups.values()) {
    siblings.sort((a, b) => a.radius - b.radius || b.size - a.size || a.slot - b.slot);
    siblings.forEach((move, rank) => {
      const at = move.slot * PIN_STRIDE;
      const delay = move.fromRest ? staggerDelay(rank, siblings.length, move.collapsing) : 0;
      array[at + PIN_OFFSET.t0] = clock + delay;
      endsAt = Math.max(endsAt, clock + delay + BLOOM_SETTLE_SECONDS);
    });
  }
  return endsAt;
}
