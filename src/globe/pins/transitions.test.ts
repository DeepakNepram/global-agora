import { describe, expect, it } from 'vitest';

import {
  latLonToVec3,
  unclusteredLayout,
  PETAL_LEVEL,
  type ClusterLayout,
  type NodeBuffer,
} from '@/core';
import {
  FIXTURE_EPOCH_SEC,
  stack,
  storyBuffer,
  type StorySpec,
} from '@/core/cluster/cluster.fixture';
import { clusterColumns } from '@/core/cluster/clusterClient';
import { createClusterEngine } from '@/core/cluster/engine';

import {
  BLOOM_SETTLE_SECONDS,
  BLOOM_TWIST_RAD,
  bloomSeconds,
  petalOffset,
  staggerStep,
} from './bloom';
import { LOOK, PIN_OFFSET, PIN_STRIDE, lookKind, writeAppearance } from './pinInstances';
import { createEnd, drawnState, readEnd, type DrawnState } from './pinPath';
import { createSlotMap } from './pinSlots';
import { planTransitions, type PlanResult } from './transitions';

const NOW = FIXTURE_EPOCH_SEC + 3600;

function layoutFor(nodes: NodeBuffer, level: number): ClusterLayout {
  const engine = createClusterEngine();
  engine.load(1, clusterColumns(nodes));
  return engine.layout(1, level, NOW);
}

/** A pin layer's bookkeeping without the mesh: the planner under test. */
function stage() {
  const slots = createSlotMap();
  const array = new Float32Array(64 * PIN_STRIDE);
  const groupSlot = new Int32Array(64).fill(-1);
  let level: number | null = null;
  let rowSlots: Int32Array = new Int32Array(0);

  const show = (
    nodes: NodeBuffer,
    layoutLevel: number | ClusterLayout,
    clock: number,
    instant = false,
  ): PlanResult & { departed: readonly number[] } => {
    const layout = typeof layoutLevel === 'number' ? layoutFor(nodes, layoutLevel) : layoutLevel;
    const assigned = slots.assign(nodes.ids, nodes.count);
    rowSlots = assigned.rowSlots;
    writeAppearance(nodes, rowSlots, array, NOW, NOW, clock, assigned.fresh);
    const plan = planTransitions({
      array,
      slotCount: slots.highWater,
      nodes,
      layout,
      rowSlots,
      fresh: assigned.fresh,
      groupSlot,
      departed: assigned.departed,
      clock,
      direction: level === null ? 0 : Math.sign(layout.level - level),
      instant: instant || level === null,
    });
    level = layout.level;
    return { ...plan, departed: assigned.departed };
  };

  const at = (id: number, clock: number): DrawnState => {
    const slot = slots.slotOf(id);
    if (slot === undefined) throw new Error(`no slot for story ${id}`);
    return drawnState(array, slot, clock, { ...createEnd(), u: 0, v: 0, alpha: 0 });
  };

  const field = (id: number, name: keyof typeof PIN_OFFSET): number =>
    array[(slots.slotOf(id) ?? 0) * PIN_STRIDE + PIN_OFFSET[name]] ?? NaN;

  return { show, at, field, array, slots };
}

function expectAt(state: DrawnState, lat: number, lon: number, digits = 5): void {
  const place = latLonToVec3({ lat, lon });
  expect(state.x).toBeCloseTo(place.x, digits);
  expect(state.y).toBeCloseTo(place.y, digits);
  expect(state.z).toBeCloseTo(place.z, digits);
}

// Five stories stacked on one city, hottest first by id, and one far away.
const STACK: StorySpec[] = [...stack(5, 20, 30, 1), { id: 50, lat: -30, lon: -60 }];
const ids = [1, 2, 3, 4, 5];

describe('planTransitions', () => {
  it('places the first layout at once: one orb for the stack, one pin', () => {
    const s = stage();
    const plan = s.show(storyBuffer(STACK), 8, 0);
    expect(plan.endsAt).toBe(0);
    expect(lookKind(s.at(1, 0).look)).toBe(LOOK.orb);
    expect(s.at(1, 0).alpha).toBe(1);
    for (const id of [2, 3, 4, 5]) expect(s.at(id, 0).alpha).toBe(0);
    expect(lookKind(s.at(50, 0).look)).toBe(LOOK.pin);
  });

  it('blooms a stack out of its orb into the sunflower, 18 ms apart', () => {
    const s = stage();
    const nodes = storyBuffer(STACK);
    s.show(nodes, 8, 0);
    const plan = s.show(nodes, PETAL_LEVEL, 10);
    expect(plan.moving).toBe(5);
    expect(plan.endsAt).toBeCloseTo(10 + bloomSeconds(5), 6);

    ids.forEach((id, petal) => {
      // Every petal starts on the orb's centre, the hottest first.
      const start = s.at(id, 10);
      expectAt(start, 20, 30);
      expect(Math.hypot(start.ox, start.oy)).toBeLessThan(1e-6);
      expect(s.field(id, 't0')).toBeCloseTo(10 + petal * staggerStep(5), 6);
      expect(s.field(id, 'twist')).toBeCloseTo(BLOOM_TWIST_RAD, 6);

      const end = s.at(id, plan.endsAt);
      const target = petalOffset(petal);
      expect(end.ox).toBeCloseTo(target.x, 1);
      expect(end.oy).toBeCloseTo(target.y, 1);
      expect(end.alpha).toBe(1);
      expect(lookKind(end.look)).toBe(LOOK.pin);
    });
    // The far pin was already where it belongs.
    expect(s.field(50, 't0')).toBe(0);
  });

  it('collapses the flower back along the same spiral, outermost first', () => {
    const s = stage();
    const nodes = storyBuffer(STACK);
    s.show(nodes, 8, 0);
    s.show(nodes, PETAL_LEVEL, 10);
    const paths = ids.map((id) => {
      const slot = s.slots.slotOf(id) ?? 0;
      return [
        readEnd(s.array, slot, 'inner', createEnd()),
        readEnd(s.array, slot, 'outer', createEnd()),
      ];
    });

    const plan = s.show(nodes, 8, 11);
    expect(plan.moving).toBe(5);
    ids.forEach((id, petal) => {
      const slot = s.slots.slotOf(id) ?? 0;
      expect([
        readEnd(s.array, slot, 'inner', createEnd()),
        readEnd(s.array, slot, 'outer', createEnd()),
      ]).toEqual(paths[petal]);
      expect(s.field(id, 'target')).toBe(0);
      expect(s.field(id, 't0')).toBeCloseTo(11 + (4 - petal) * staggerStep(5), 6);
    });
    const settled = plan.endsAt + 0.01;
    expect(lookKind(s.at(1, settled).look)).toBe(LOOK.orb);
    expectAt(s.at(1, settled), 20, 30);
    for (const id of [2, 3, 4, 5]) expect(s.at(id, settled).alpha).toBe(0);
  });

  it('turns a half-open bloom back from exactly where it is', () => {
    const s = stage();
    const nodes = storyBuffer(STACK);
    s.show(nodes, 8, 0);
    s.show(nodes, PETAL_LEVEL, 10);
    const midway = 10.1;
    const before = ids.map((id) => s.at(id, midway));
    s.show(nodes, 8, midway);
    ids.forEach((id, i) => {
      const after = s.at(id, midway);
      const was = before[i];
      // Equal up to the float32 the spring state is stored in.
      expect(after.ox).toBeCloseTo(was?.ox ?? NaN, 4);
      expect(after.oy).toBeCloseTo(was?.oy ?? NaN, 4);
      expect(after.alpha).toBeCloseTo(was?.alpha ?? NaN, 5);
      // Already moving, so no stagger delay: it turns at once.
      expect(s.field(id, 't0')).toBeCloseTo(midway, 6);
    });
  });

  it('sends each child of a split cluster spiralling out to its own place', () => {
    const s = stage();
    const nodes = storyBuffer([
      { id: 1, lat: 0, lon: 0 },
      { id: 2, lat: 0, lon: 1 },
    ]);
    s.show(nodes, 4, 0);
    const orb = s.at(1, 0);
    const plan = s.show(nodes, 6, 5);
    expect(plan.moving).toBe(2);

    const emerging = s.at(2, 5);
    expect(emerging.x).toBeCloseTo(orb.x, 6);
    expect(emerging.z).toBeCloseTo(orb.z, 6);
    expect(emerging.alpha).toBe(0);
    expect(s.field(2, 'twist')).toBeCloseTo(BLOOM_TWIST_RAD, 6);

    const done = plan.endsAt + 0.01;
    expectAt(s.at(1, done), 0, 0, 4);
    expectAt(s.at(2, done), 0, 1, 4);
    expect(lookKind(s.at(1, done).look)).toBe(LOOK.pin);
  });

  it('starts a path from a petal exactly where the petal is drawn', () => {
    const s = stage();
    const nodes = storyBuffer(STACK);
    s.show(nodes, 8, 0);
    s.show(nodes, PETAL_LEVEL, 10);
    const settled = 11;
    const before = ids.map((id) => s.at(id, settled));
    // Clustering switched off: every petal heads for its own place, twisting on the way.
    const plan = s.show(nodes, unclusteredLayout(nodes, NOW), settled);
    expect(plan.moving).toBeGreaterThan(0);
    ids.forEach((id, i) => {
      const after = s.at(id, settled);
      expect(after.ox).toBeCloseTo(before[i]?.ox ?? NaN, 4);
      expect(after.oy).toBeCloseTo(before[i]?.oy ?? NaN, 4);
    });
  });

  it('keeps every story still when a refresh only reorders the rows', () => {
    const s = stage();
    s.show(storyBuffer(STACK), 8, 0);
    const plan = s.show(storyBuffer([...STACK].reverse()), 8, 1);
    expect(plan.moving).toBe(0);
    expect(plan.endsAt).toBe(1);
  });

  it('fades a story that left where it is, and a new one in where it belongs', () => {
    const s = stage();
    s.show(storyBuffer(STACK), 8, 0);
    const farSlot = s.slots.slotOf(50);
    const plan = s.show(storyBuffer([...STACK.slice(0, 5), { id: 60, lat: 45, lon: 90 }]), 8, 2);
    expect(plan.departed).toEqual([farSlot]);

    const leaving = drawnState(s.array, farSlot ?? 0, 2, { ...createEnd(), u: 0, v: 0, alpha: 0 });
    expect(leaving.alpha).toBe(1);
    expectAt(leaving, -30, -60);
    const gone = drawnState(s.array, farSlot ?? 0, 2 + BLOOM_SETTLE_SECONDS, {
      ...createEnd(),
      u: 0,
      v: 0,
      alpha: 0,
    });
    expect(gone.alpha).toBe(0);
    expectAt(gone, -30, -60);

    expect(s.at(60, 2).alpha).toBe(0);
    expectAt(s.at(60, 2), 45, 90);
    expect(s.at(60, 2 + BLOOM_SETTLE_SECONDS).alpha).toBe(1);
  });

  it('lands every change at once when told to, as under reduced motion', () => {
    const s = stage();
    const nodes = storyBuffer(STACK);
    s.show(nodes, 8, 0);
    const plan = s.show(nodes, PETAL_LEVEL, 5, true);
    expect(plan.endsAt).toBe(5);
    const last = s.at(5, 5);
    expect(last.ox).toBeCloseTo(petalOffset(4).x, 3);
    expect(last.alpha).toBe(1);
  });
});
