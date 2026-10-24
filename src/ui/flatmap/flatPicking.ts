import {
  CLUSTER_ROLE,
  isFilterActive,
  matchesFilter,
  rowOfStory,
  vec3ToLatLon,
  flatProject,
  type ClusterLayout,
  type FlatSize,
  type FlatView,
  type NodeBuffer,
  type StoryFilter,
} from '@/core';
import { drawnTargets, groupMatches, locateRow, pickPin, type ProjectPoint } from '@/globe';

import type { PinSource } from '../globe/pinPicker';

/** What the flat map has drawn, as picking and drawing need it. */
export interface FlatDrawn {
  readonly nodes: NodeBuffer;
  readonly layout: ClusterLayout;
  readonly view: FlatView;
  readonly size: FlatSize;
  readonly nowSec: number;
  readonly filter: StoryFilter;
}

/**
 * The flat map's points through the same picking as the globe's
 * (pinPick.ts): only the projection differs. A unit-sphere point is drawn
 * where the map puts its latitude and longitude, and counts when it is in
 * the frame.
 */
export function flatProjection(view: FlatView, size: FlatSize): ProjectPoint {
  return (x, y, z, out) => {
    const at = vec3ToLatLon({ x, y, z });
    flatProject(view, size, at.lat, at.lon, out);
    return out.x >= 0 && out.x <= size.width && out.y >= 0 && out.y <= size.height;
  };
}

/**
 * Which rows the filters leave out: a pin by its own story, an orb when
 * none of its stories match, as on the globe (pinFilter.ts). Null when no
 * filter is set.
 */
export function flatDimming(drawn: FlatDrawn): ((row: number) => boolean) | null {
  const { nodes, layout, nowSec, filter } = drawn;
  if (!isFilterActive(filter)) return null;
  const matched = new Uint8Array(Math.min(nodes.count, layout.count));
  groupMatches(nodes, layout, nowSec, filter, matched);
  return (row) =>
    layout.roles[row] === CLUSTER_ROLE.orb
      ? matched[row] !== 1
      : !matchesFilter(nodes, row, nowSec, filter);
}

/** The row wearing the selection ring: the story's own, or the orb holding it; −1 for none. */
export function ringedRow(nodes: NodeBuffer, layout: ClusterLayout, id: number | null): number {
  if (id === null) return -1;
  const row = rowOfStory(nodes, id);
  if (row < 0 || row >= layout.count) return -1;
  return layout.roles[row] === CLUSTER_ROLE.hidden ? (layout.groups[row] ?? -1) : row;
}

/** A PinSource for the picker: taps, Tab and the focus ring on the flat map. */
export function flatPinSource(drawn: () => FlatDrawn | null, size: () => FlatSize): PinSource {
  const input = (): Parameters<typeof drawnTargets>[0] | null => {
    const state = drawn();
    if (!state) return null;
    const dimmed = flatDimming(state);
    return {
      nodes: state.nodes,
      layout: state.layout,
      nowSec: state.nowSec,
      project: flatProjection(state.view, state.size),
      ...(dimmed ? { dimmed } : {}),
    };
  };
  return {
    pick(x, y, radiusPx) {
      const base = input();
      return base
        ? pickPin({ ...base, x, y, ...(radiusPx === undefined ? {} : { radiusPx }) })
        : null;
    },
    targets(bounds) {
      const base = input();
      const { width, height } = size();
      return base
        ? drawnTargets(base, bounds ?? { left: 0, top: 0, right: width, bottom: height })
        : [];
    },
    locate(row) {
      const base = input();
      return base ? locateRow(base, row) : null;
    },
    viewport: () => ({ ...size() }),
  };
}
