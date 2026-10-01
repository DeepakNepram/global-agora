import { describe, expect, it } from 'vitest';

import { CLUSTER_ROLE, NO_FILTER, type ClusterLayout, type StoryFilter } from '@/core';
import { FIXTURE_EPOCH_SEC, storyBuffer } from '@/core/cluster/cluster.fixture';
import { createLayoutColumns } from '@/core/cluster/layout';

import {
  createFilterState,
  createFilterUniforms,
  filterFade,
  groupMatches,
  FILTER_FADE_SECONDS,
} from './pinFilter';

const NOW = FIXTURE_EPOCH_SEC + 10 * 3600;
const CLIMATE: StoryFilter = { categories: ['climate'], withinHours: null };

/**
 * Five stories: rows 0–2 one cluster (row 0 its orb), rows 3 and 4 pins.
 * Categories: 0 world, 5 climate. Row 2 is the cluster's only climate story.
 */
function scene(): { nodes: ReturnType<typeof storyBuffer>; layout: ClusterLayout } {
  const nodes = storyBuffer([
    { id: 1, lat: 0, lon: 0, category: 0, t: 0 },
    { id: 2, lat: 0, lon: 0, category: 0, t: 3600 },
    { id: 3, lat: 0, lon: 0, category: 5, t: 9.5 * 3600 },
    { id: 4, lat: 10, lon: 10, category: 0, t: 9.5 * 3600 },
    { id: 5, lat: 20, lon: 20, category: 5, t: 0 },
  ]);
  const columns = createLayoutColumns(5);
  columns.roles.set([
    CLUSTER_ROLE.orb,
    CLUSTER_ROLE.hidden,
    CLUSTER_ROLE.hidden,
    CLUSTER_ROLE.pin,
    CLUSTER_ROLE.pin,
  ]);
  columns.groups.set([0, 0, 0, 3, 4]);
  columns.counts.set([3, 3, 3, 1, 1]);
  return {
    nodes,
    layout: { generation: 0, level: 2, open: false, count: 5, visible: 5, ...columns },
  };
}

describe('groupMatches', () => {
  it('matches an orb when any member does', () => {
    const { nodes, layout } = scene();
    const out = new Uint8Array(5);
    groupMatches(nodes, layout, NOW, CLIMATE, out);
    expect(Array.from(out)).toEqual([1, 0, 0, 0, 1]);
  });

  it('counts the window back from the displayed instant', () => {
    const { nodes, layout } = scene();
    const out = new Uint8Array(5);
    groupMatches(nodes, layout, NOW, { categories: [], withinHours: 1 }, out);
    expect(Array.from(out)).toEqual([1, 0, 0, 1, 0]);
    groupMatches(nodes, layout, FIXTURE_EPOCH_SEC + 1800, { categories: [], withinHours: 1 }, out);
    expect(Array.from(out)).toEqual([1, 0, 0, 0, 1]);
  });
});

describe('filterFade', () => {
  it('runs from 0 to 1 over the fade and stays there', () => {
    expect(filterFade(0)).toBe(0);
    expect(filterFade(FILTER_FADE_SECONDS / 2)).toBeCloseTo(0.875, 6);
    expect(filterFade(FILTER_FADE_SECONDS)).toBe(1);
    expect(filterFade(10)).toBe(1);
  });
});

describe('createFilterState', () => {
  it('writes the categories and the window for the shader, keeping the previous to fade from', () => {
    const uniforms = createFilterUniforms();
    const state = createFilterState(uniforms);
    expect(state.set({ categories: ['climate', 'tech'], withinHours: 6 }, false)).toBe(true);
    expect(Array.from(uniforms.uCategoryOn.value)).toEqual([0, 0, 0, 0, 0, 1, 1, 0]);
    expect(Array.from(uniforms.uCategoryOnPrev.value)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(uniforms.uWithin.value).toBe(6 * 3600);
    expect(uniforms.uWithinPrev.value).toBe(-1);
    expect(uniforms.uFilterMix.value).toBe(0);
  });

  it('fades by its own elapsed time, then settles on the new filter', () => {
    const uniforms = createFilterUniforms();
    const state = createFilterState(uniforms);
    state.set(CLIMATE, false);
    expect(state.advance(FILTER_FADE_SECONDS / 2)).toBe(true);
    expect(uniforms.uFilterMix.value).toBeCloseTo(0.875, 6);
    expect(state.advance(FILTER_FADE_SECONDS)).toBe(false);
    expect(uniforms.uFilterMix.value).toBe(1);
    expect(Array.from(uniforms.uCategoryOnPrev.value)).toEqual(
      Array.from(uniforms.uCategoryOn.value),
    );
    expect(state.advance(1)).toBe(false);
  });

  it('switches at once when asked to (reduced motion), and ignores a same filter', () => {
    const uniforms = createFilterUniforms();
    const state = createFilterState(uniforms);
    expect(state.set(NO_FILTER, false)).toBe(false);
    state.set(CLIMATE, true);
    expect(uniforms.uFilterMix.value).toBe(1);
    expect(state.advance(0.1)).toBe(false);
    expect(state.set({ categories: ['climate'], withinHours: null }, false)).toBe(false);
  });

  it('writes (previous, current) for orb slots only', () => {
    const { nodes, layout } = scene();
    const state = createFilterState(createFilterUniforms());
    const orbMatch = new Float32Array(10).fill(1);
    const rowSlots = Int32Array.from([4, 3, 2, 1, 0]);
    state.set({ categories: ['tech'], withinHours: null }, false);
    expect(state.writeOrbs(nodes, layout, rowSlots, NOW, orbMatch, true)).toBe(true);
    // Row 0's orb is slot 4: matched before (no filter), not now (no tech story).
    expect(Array.from(orbMatch.subarray(8, 10))).toEqual([1, 0]);
    expect(Array.from(orbMatch.subarray(0, 8))).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('skips a recheck within a second of story time unless forced', () => {
    const { nodes, layout } = scene();
    const state = createFilterState(createFilterUniforms());
    const orbMatch = new Float32Array(10);
    const rowSlots = Int32Array.from([0, 1, 2, 3, 4]);
    expect(state.writeOrbs(nodes, layout, rowSlots, NOW, orbMatch, false)).toBe(true);
    expect(state.writeOrbs(nodes, layout, rowSlots, NOW + 0.5, orbMatch, false)).toBe(false);
    expect(state.writeOrbs(nodes, layout, rowSlots, NOW + 0.5, orbMatch, true)).toBe(true);
    expect(state.writeOrbs(nodes, layout, rowSlots, NOW + 2, orbMatch, false)).toBe(true);
  });

  it('says which rows are dimmed, orbs by their members', () => {
    const { nodes, layout } = scene();
    const state = createFilterState(createFilterUniforms());
    const rowSlots = Int32Array.from([0, 1, 2, 3, 4]);
    expect(state.dimmed(nodes, layout, 3, NOW)).toBe(false);
    state.set(CLIMATE, true);
    state.writeOrbs(nodes, layout, rowSlots, NOW, new Float32Array(10), true);
    expect(state.dimmed(nodes, layout, 0, NOW)).toBe(false);
    expect(state.dimmed(nodes, layout, 3, NOW)).toBe(true);
    expect(state.dimmed(nodes, layout, 4, NOW)).toBe(false);
  });
});
