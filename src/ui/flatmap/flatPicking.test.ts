import { describe, expect, it } from 'vitest';

import { CLUSTER_ROLE, latLonToVec3, NO_FILTER, unclusteredLayout } from '@/core';
import { FIXTURE_EPOCH_SEC, storyBuffer } from '@/core/cluster/cluster.fixture';
import { pickPin } from '@/globe';

import { flatDimming, flatProjection, ringedRow } from './flatPicking';

const size = { width: 720, height: 360 };
const view = { lat: 0, lon: 0, scale: 2 };

describe('flat map picking', () => {
  it('projects a point on the sphere where the map draws its place, and only inside the frame', () => {
    const project = flatProjection(view, size);
    const out = { x: 0, y: 0 };
    const paris = latLonToVec3({ lat: 48.86, lon: 2.35 });
    expect(project(paris.x, paris.y, paris.z, out)).toBe(true);
    expect(out.x).toBeCloseTo(360 + 2.35 * 2, 6);
    expect(out.y).toBeCloseTo(180 - 48.86 * 2, 6);
    const zoomed = flatProjection({ lat: 0, lon: 0, scale: 20 }, size);
    expect(zoomed(paris.x, paris.y, paris.z, out)).toBe(false);
  });

  it('picks a story on the map with the globe’s own picking', () => {
    const nodes = storyBuffer([{ id: 9, lat: -33.9, lon: 151.2, t: 0 }]);
    const layout = unclusteredLayout(nodes, FIXTURE_EPOCH_SEC + 60);
    const hit = pickPin({
      nodes,
      layout,
      nowSec: FIXTURE_EPOCH_SEC + 60,
      x: 360 + 151.2 * 2,
      y: 180 + 33.9 * 2,
      project: flatProjection(view, size),
    });
    expect(hit).toMatchObject({ kind: 'story', id: 9 });
  });

  it('rings the story, or the orb holding it', () => {
    const nodes = storyBuffer([
      { id: 1, lat: 0, lon: 0, t: 0 },
      { id: 2, lat: 0, lon: 1, t: 0 },
    ]);
    const layout = unclusteredLayout(nodes, FIXTURE_EPOCH_SEC + 60);
    expect(ringedRow(nodes, layout, 2)).toBe(1);
    layout.roles[1] = CLUSTER_ROLE.hidden;
    layout.groups[1] = 0;
    expect(ringedRow(nodes, layout, 2)).toBe(0);
    expect(ringedRow(nodes, layout, null)).toBe(-1);
    expect(ringedRow(nodes, layout, 99)).toBe(-1);
  });

  it('dims nothing without a filter, and what a category filter leaves out', () => {
    const nodes = storyBuffer([
      { id: 1, lat: 0, lon: 0, t: 0 },
      { id: 2, lat: 0, lon: 1, t: 0 },
    ]);
    nodes.categories.set([1, 3]);
    const layout = unclusteredLayout(nodes, FIXTURE_EPOCH_SEC + 60);
    const base = { nodes, layout, view, size, nowSec: FIXTURE_EPOCH_SEC + 60 };
    expect(flatDimming({ ...base, filter: NO_FILTER })).toBeNull();
    const dimmed = flatDimming({
      ...base,
      filter: { categories: ['conflict'], withinHours: null },
    });
    expect(dimmed?.(0)).toBe(false);
    expect(dimmed?.(1)).toBe(true);
  });
});
