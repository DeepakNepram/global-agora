import { describe, expect, it } from 'vitest';

import { FIXTURE_EPOCH_SEC, stack, storyBuffer, type StorySpec } from './cluster.fixture';
import { clusterColumns } from './clusterClient';
import { CLUSTER_MAX_ZOOM, PETAL_LEVEL } from './constants';
import { createClusterEngine, handleClusterRequest } from './engine';
import { CLUSTER_ROLE, type ClusterLayout } from './layout';

const NOW = FIXTURE_EPOCH_SEC + 3600;

function layoutOf(
  specs: readonly StorySpec[],
  level: number,
  nowSec = NOW,
  open = false,
): ClusterLayout {
  const engine = createClusterEngine();
  engine.load(1, clusterColumns(storyBuffer(specs)));
  return engine.layout(1, level, nowSec, open);
}

function rolesOf(layout: ClusterLayout): number[] {
  return Array.from(layout.roles);
}

describe('createClusterEngine', () => {
  it('leaves stories a hemisphere apart as their own pins at every level', () => {
    const specs = [
      { id: 1, lat: 0, lon: 0 },
      { id: 2, lat: 0, lon: 90 },
    ];
    for (const level of [0, 4, CLUSTER_MAX_ZOOM, PETAL_LEVEL]) {
      const layout = layoutOf(specs, level);
      expect(rolesOf(layout)).toEqual([CLUSTER_ROLE.pin, CLUSTER_ROLE.pin]);
      expect(Array.from(layout.groups)).toEqual([0, 1]);
      expect(Array.from(layout.counts)).toEqual([1, 1]);
    }
  });

  it('draws a stack as one orb by its lowest-id member, whatever the row order', () => {
    const specs = [{ id: 40, lat: 10, lon: 10 }, ...stack(4, 51.5, -0.12, 7).reverse()];
    const layout = layoutOf(specs, 3);
    // Rows 1..4 are ids 10, 9, 8, 7: id 7 (row 4) represents the stack.
    expect(rolesOf(layout)).toEqual([
      CLUSTER_ROLE.pin,
      CLUSTER_ROLE.hidden,
      CLUSTER_ROLE.hidden,
      CLUSTER_ROLE.hidden,
      CLUSTER_ROLE.orb,
    ]);
    expect(Array.from(layout.groups)).toEqual([0, 4, 4, 4, 4]);
    expect(Array.from(layout.counts)).toEqual([1, 4, 4, 4, 4]);
  });

  it('puts every member of a cluster at the cluster centre', () => {
    const layout = layoutOf(stack(3, 51.5, -0.12, 1), 2);
    const [x = 0, y = 0, z = 0] = layout.anchors;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
    for (let row = 1; row < 3; row++) {
      expect(layout.anchors[row * 3]).toBeCloseTo(x, 5);
      expect(layout.anchors[row * 3 + 1]).toBeCloseTo(y, 5);
      expect(layout.anchors[row * 3 + 2]).toBeCloseTo(z, 5);
    }
  });

  it('fans a stack into petals at the petal level, hottest first', () => {
    const specs: StorySpec[] = [
      { id: 1, lat: 20, lon: 30, heat: 50 },
      { id: 2, lat: 20, lon: 30, heat: 200 },
      { id: 3, lat: 20, lon: 30, heat: 120 },
      { id: 4, lat: 20, lon: 30, heat: 200 },
    ];
    const layout = layoutOf(specs, PETAL_LEVEL);
    expect(rolesOf(layout)).toEqual(new Array(4).fill(CLUSTER_ROLE.petal));
    // Heat 200 twice: the lower id goes first.
    expect(Array.from(layout.petals)).toEqual([3, 0, 2, 1]);
    expect(Array.from(layout.groups)).toEqual([0, 0, 0, 0]);
  });

  it('splits places a degree apart once the level is deep enough', () => {
    // 44 px at level L spans 360° · 44 / (512 · 2^L): 1.9° at level 4, 0.97° at 5.
    const specs = [
      { id: 1, lat: 0, lon: 0 },
      { id: 2, lat: 0, lon: 1 },
    ];
    expect(rolesOf(layoutOf(specs, 4))).toEqual([CLUSTER_ROLE.orb, CLUSTER_ROLE.hidden]);
    expect(rolesOf(layoutOf(specs, 6))).toEqual([CLUSTER_ROLE.pin, CLUSTER_ROLE.pin]);
  });

  it('colours a cluster by its most common category, ties going to the hotter one', () => {
    const at = (id: number, category: number, heat: number): StorySpec => ({
      id,
      lat: 5,
      lon: 5,
      category,
      heat,
    });
    const majority = layoutOf(
      [at(1, 1, 10), at(2, 2, 250), at(3, 2, 250), at(4, 1, 10), at(5, 1, 10)],
      3,
    );
    expect(majority.categories[0]).toBe(1);
    const tie = layoutOf([at(1, 1, 10), at(2, 2, 90), at(3, 2, 90), at(4, 1, 10)], 3);
    expect(tie.categories[0]).toBe(2);
  });

  it('clusters only stories published at the instant and leaves the rest as their own pins', () => {
    const specs = [...stack(3, 30, 30, 1), { id: 9, lat: 30, lon: 30, t: 7200 }];
    const layout = layoutOf(specs, 3, NOW);
    expect(layout).toMatchObject({ visible: 3, open: false });
    // The shader hides it until 7200 s; as a pin it appears the moment the time passes that.
    expect(layout.roles[3]).toBe(CLUSTER_ROLE.pin);
    expect(layout.groups[3]).toBe(3);
    expect(layout.counts[0]).toBe(3);
    const later = layoutOf(specs, 3, FIXTURE_EPOCH_SEC + 7200);
    expect(later.visible).toBe(4);
    expect(later.counts[0]).toBe(4);
    expect(later.roles[3]).toBe(CLUSTER_ROLE.hidden);
  });

  it('opens every cluster into pins below the petal level, whatever the time', () => {
    const specs = [...stack(3, 30, 30, 1), { id: 9, lat: 30, lon: 30, t: 7200 }];
    for (const nowSec of [NOW, FIXTURE_EPOCH_SEC + 7200]) {
      const layout = layoutOf(specs, 3, nowSec, true);
      expect(layout.open).toBe(true);
      expect(Array.from(layout.roles)).toEqual(new Array(4).fill(CLUSTER_ROLE.pin));
      expect(Array.from(layout.groups)).toEqual([0, 1, 2, 3]);
    }
  });

  it('opens at the petal level into sunflowers of every story, published or not', () => {
    const specs = [...stack(3, 30, 30, 1), { id: 9, lat: 30, lon: 30, t: 7200 }];
    const layout = layoutOf(specs, PETAL_LEVEL, NOW, true);
    expect(Array.from(layout.roles)).toEqual(new Array(4).fill(CLUSTER_ROLE.petal));
    expect(Array.from(layout.counts)).toEqual([4, 4, 4, 4]);
    expect(new Set(layout.petals).size).toBe(4);
  });

  it('clamps the level into the range it knows', () => {
    expect(layoutOf(stack(2, 0, 0, 1), 42).level).toBe(PETAL_LEVEL);
    expect(layoutOf(stack(2, 0, 0, 1), -3).level).toBe(0);
  });

  it('refuses a layout for a generation it has not loaded', () => {
    const engine = createClusterEngine();
    expect(() => engine.layout(1, 0, NOW)).toThrow(/generation/);
    engine.load(2, clusterColumns(storyBuffer(stack(2, 0, 0, 1))));
    expect(() => engine.layout(1, 0, NOW)).toThrow(/generation 1/);
  });
});

describe('handleClusterRequest', () => {
  it('answers a load with nothing and a layout with transferable buffers', () => {
    const engine = createClusterEngine();
    const columns = clusterColumns(storyBuffer(stack(3, 0, 0, 1)));
    expect(handleClusterRequest(engine, { type: 'load', generation: 1, columns })).toBeNull();

    const handled = handleClusterRequest(engine, {
      type: 'layout',
      generation: 1,
      request: 5,
      level: 2,
      nowSec: NOW,
      open: false,
    });
    expect(handled?.reply.type).toBe('layout');
    expect(handled?.reply.request).toBe(5);
    expect(handled?.transfer).toHaveLength(6);
  });

  it('turns an engine error into an error reply', () => {
    const handled = handleClusterRequest(createClusterEngine(), {
      type: 'layout',
      generation: 3,
      request: 1,
      level: 0,
      nowSec: NOW,
      open: false,
    });
    expect(handled?.reply).toMatchObject({ type: 'error', request: 1 });
    expect(handled?.transfer).toEqual([]);
  });
});
