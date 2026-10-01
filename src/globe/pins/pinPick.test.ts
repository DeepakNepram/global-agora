import { describe, expect, it } from 'vitest';

import { CLUSTER_ROLE, latLonToVec3, type ClusterLayout, type ClusterRole } from '@/core';
import { FIXTURE_EPOCH_SEC, storyBuffer } from '@/core/cluster/cluster.fixture';
import { createLayoutColumns } from '@/core/cluster/layout';

import { petalOffset } from './bloom';
import { PICK_RADIUS_CSS_PX, pickPin, type ProjectPoint } from './pinPick';

/**
 * A stand-in camera looking down −z at the globe: a unit-sphere point lands
 * at (500 + 400x, 500 − 400y) CSS px, and only the near hemisphere is drawn.
 */
const project: ProjectPoint = (x, y, z, out) => {
  out.x = 500 + 400 * x;
  out.y = 500 - 400 * y;
  return z > 0.1;
};

interface RowSpec {
  /** Where it lands on screen, CSS px; the anchor is put on the near side to match. */
  readonly at: readonly [number, number];
  readonly role: ClusterRole;
  readonly count?: number;
  readonly petal?: number;
  /** Seconds after the window start the story is published. */
  readonly t?: number;
  readonly far?: boolean;
}

function scene(
  rows: readonly RowSpec[],
  level = 3,
): {
  nodes: ReturnType<typeof storyBuffer>;
  layout: ClusterLayout;
} {
  const nodes = storyBuffer(rows.map((row, i) => ({ id: 100 + i, lat: 0, lon: 0, t: row.t ?? 0 })));
  const columns = createLayoutColumns(rows.length);
  rows.forEach((row, i) => {
    const x = (row.at[0] - 500) / 400;
    const y = (500 - row.at[1]) / 400;
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y)) * (row.far ? -1 : 1);
    columns.anchors.set([x, y, z], i * 3);
    columns.roles[i] = row.role;
    columns.groups[i] = i;
    columns.counts[i] = row.count ?? 1;
    columns.petals[i] = row.petal ?? 0;
  });
  return {
    nodes,
    layout: {
      generation: 0,
      level,
      open: false,
      count: rows.length,
      visible: rows.length,
      ...columns,
    },
  };
}

const NOW = FIXTURE_EPOCH_SEC + 3600;

function pickAt(rows: readonly RowSpec[], x: number, y: number) {
  const { nodes, layout } = scene(rows);
  return pickPin({ nodes, layout, nowSec: NOW, x, y, project });
}

describe('pickPin', () => {
  it('picks the nearest pin within a 44 px target, and nothing beyond', () => {
    const rows: RowSpec[] = [
      { at: [500, 500], role: CLUSTER_ROLE.pin },
      { at: [512, 500], role: CLUSTER_ROLE.pin },
    ];
    expect(pickAt(rows, 509, 500)).toMatchObject({ kind: 'story', row: 1, id: 101 });
    expect(pickAt(rows, 495, 503)).toMatchObject({ kind: 'story', row: 0, id: 100 });
    expect(pickAt(rows, 500, 500 - PICK_RADIUS_CSS_PX - 1)).toBeNull();
    expect(pickAt(rows, 500, 500 - PICK_RADIUS_CSS_PX + 1)).toMatchObject({ row: 0 });
  });

  it('skips what is not drawn: hidden rows, the far side, and stories not yet published', () => {
    expect(pickAt([{ at: [500, 500], role: CLUSTER_ROLE.hidden }], 500, 500)).toBeNull();
    expect(pickAt([{ at: [500, 500], role: CLUSTER_ROLE.pin, far: true }], 500, 500)).toBeNull();
    const future = [{ at: [500, 500] as const, role: CLUSTER_ROLE.pin, t: 7200 }];
    expect(pickAt(future, 500, 500)).toBeNull();
    const published = [{ at: [500, 500] as const, role: CLUSTER_ROLE.pin, t: 3600 }];
    expect(pickAt(published, 500, 500)).toMatchObject({ kind: 'story' });
  });

  it('finds a petal where the sunflower drew it, y up on screen', () => {
    const offset = petalOffset(5);
    const rows: RowSpec[] = [
      { at: [500, 500], role: CLUSTER_ROLE.petal, petal: 0 },
      { at: [500, 500], role: CLUSTER_ROLE.petal, petal: 5 },
    ];
    const hit = pickAt(rows, 500 + offset.x, 500 - offset.y);
    expect(hit).toMatchObject({ kind: 'story', row: 1 });
    expect(pickAt(rows, 500, 500)).toMatchObject({ kind: 'story', row: 0 });
  });

  it('reports an orb as a cluster, with its place, size and level, and never time-gates it', () => {
    const { nodes, layout } = scene(
      [{ at: [500, 500], role: CLUSTER_ROLE.orb, count: 40, t: 99_999 }],
      4,
    );
    const hit = pickPin({ nodes, layout, nowSec: NOW, x: 503, y: 498, project });
    expect(hit).toMatchObject({ kind: 'cluster', row: 0, count: 40, level: 4 });
    if (hit?.kind !== 'cluster') throw new Error('expected a cluster');
    const at = latLonToVec3(hit.at);
    expect(at.z).toBeCloseTo(1, 6);
  });

  it('lets a pin under the finger beat the edge of a large orb', () => {
    const rows: RowSpec[] = [
      { at: [500, 500], role: CLUSTER_ROLE.orb, count: 1000 },
      { at: [522, 500], role: CLUSTER_ROLE.pin },
    ];
    expect(pickAt(rows, 521, 500)).toMatchObject({ kind: 'story', row: 1 });
    expect(pickAt(rows, 503, 500)).toMatchObject({ kind: 'cluster', row: 0 });
  });

  it('takes a wider radius for the keyboard', () => {
    const { nodes, layout } = scene([{ at: [540, 500], role: CLUSTER_ROLE.pin }]);
    const input = { nodes, layout, nowSec: NOW, x: 500, y: 500, project };
    expect(pickPin(input)).toBeNull();
    expect(pickPin({ ...input, radiusPx: 48 })).toMatchObject({ row: 0 });
  });
});
