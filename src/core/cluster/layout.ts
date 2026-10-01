import { NEWS_CATEGORIES, type NodeBuffer } from '../nodeBuffer';

import { UNCLUSTERED_LEVEL } from './constants';

/**
 * What each story row does at one cluster level, as columns: the clustering
 * engine's answer and the pin layer's input. Rows are the rows of the
 * NodeBuffer the layout was computed from.
 *
 * Time is not a role. A story not yet published at the layout's instant is a
 * pin at its own place, and the pin shader keeps it hidden until its publish
 * time, so moving the time shows it at once, before any new layout arrives.
 */

export const CLUSTER_ROLE = {
  /** Inside a cluster its representative draws. */
  hidden: 0,
  /** Its own pin at its own place. */
  pin: 1,
  /** Draws its whole cluster as an orb with a count. */
  orb: 2,
  /** Its own pin, fanned out around a stack's centre. */
  petal: 3,
} as const;

export type ClusterRole = (typeof CLUSTER_ROLE)[keyof typeof CLUSTER_ROLE];

export interface ClusterLayout {
  /** The client's generation for the NodeBuffer this was computed from. */
  readonly generation: number;
  readonly level: number;
  /**
   * Clusters opened while the time moves (a drag or Play): every story its own
   * pin, or at PETAL_LEVEL a petal, whatever its publish time.
   */
  readonly open: boolean;
  /** Rows covered: the NodeBuffer's count. */
  readonly count: number;
  /** Rows published at the layout's instant; clusters hold only these. */
  readonly visible: number;
  /** CLUSTER_ROLE per row. */
  readonly roles: Uint8Array;
  /**
   * Row of the group's representative, the member with the lowest story id;
   * the row itself for a pin. Story ids only grow, so the same cluster keeps
   * the same representative across payload refreshes.
   */
  readonly groups: Int32Array;
  /** Where the row's group sits, xyz per row: its own place for a pin, else the cluster centre. */
  readonly anchors: Float32Array;
  /** Stories in the row's group; 1 for a pin. */
  readonly counts: Uint16Array;
  /** The group's dominant category: most members, ties to the higher total heat. */
  readonly categories: Uint8Array;
  /** Petal index for petals, hottest first (0 sits at the centre); 0 otherwise. */
  readonly petals: Uint16Array;
}

export interface LayoutColumns {
  roles: Uint8Array;
  groups: Int32Array;
  anchors: Float32Array;
  counts: Uint16Array;
  categories: Uint8Array;
  petals: Uint16Array;
}

/** Fresh, empty columns for `count` rows. */
export function createLayoutColumns(count: number): LayoutColumns {
  return {
    roles: new Uint8Array(count),
    groups: new Int32Array(count).fill(-1),
    anchors: new Float32Array(count * 3),
    counts: new Uint16Array(count),
    categories: new Uint8Array(count),
    petals: new Uint16Array(count),
  };
}

export interface StoryColumns {
  readonly count: number;
  readonly epochSec: number;
  readonly positions: Float32Array;
  readonly publishedSec: Int32Array;
  readonly categories: Uint8Array;
}

export function isPublished(nodes: StoryColumns, row: number, nowSec: number): boolean {
  return nodes.epochSec + (nodes.publishedSec[row] ?? 0) <= nowSec;
}

/**
 * Stories published by `nowSec`. Visibility is a threshold on publish time, so
 * the visible sets at two instants are nested and equal counts mean equal sets.
 */
export function countVisible(nodes: StoryColumns, nowSec: number): number {
  let visible = 0;
  for (let row = 0; row < nodes.count; row++) if (isPublished(nodes, row, nowSec)) visible++;
  return visible;
}

/** Writes `row` as a lone pin at its own place. */
export function writePin(out: LayoutColumns, nodes: StoryColumns, row: number): void {
  out.roles[row] = CLUSTER_ROLE.pin;
  out.groups[row] = row;
  out.anchors[row * 3] = nodes.positions[row * 3] ?? 0;
  out.anchors[row * 3 + 1] = nodes.positions[row * 3 + 1] ?? 0;
  out.anchors[row * 3 + 2] = nodes.positions[row * 3 + 2] ?? 0;
  out.counts[row] = 1;
  const category = nodes.categories[row] ?? 0;
  out.categories[row] = category < NEWS_CATEGORIES.length ? category : 0;
  out.petals[row] = 0;
}

/**
 * Every story as its own pin: clustering switched off, the pin benchmark (so
 * it stays comparable with 1.5's numbers) and tests. Like every layout it
 * leaves publish times to the shader, so it holds at any instant.
 */
export function unclusteredLayout(
  nodes: NodeBuffer,
  nowSec: number,
  generation = 0,
): ClusterLayout {
  const out = createLayoutColumns(nodes.count);
  for (let row = 0; row < nodes.count; row++) writePin(out, nodes, row);
  return {
    generation,
    level: UNCLUSTERED_LEVEL,
    open: false,
    count: nodes.count,
    visible: countVisible(nodes, nowSec),
    ...out,
  };
}
