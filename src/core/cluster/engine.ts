import Supercluster, { type ClusterFeature, type PointFeature } from 'supercluster';

import { latLonToVec3, vec3ToLatLon } from '../geo';
import { NEWS_CATEGORIES } from '../nodeBuffer';

import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS_PX, CLUSTER_TILE_PX, PETAL_LEVEL } from './constants';
import {
  CLUSTER_ROLE,
  countVisible,
  createLayoutColumns,
  isPublished,
  writePin,
  type ClusterLayout,
  type LayoutColumns,
} from './layout';
import {
  layoutBuffers,
  type ClusterColumns,
  type ClusterReply,
  type ClusterRequest,
} from './protocol';

/**
 * The clustering engine: supercluster over one payload's stories, answering
 * "what does each story do at level L". Runs in a Web Worker (see
 * src/ui/data/cluster.worker.ts) so building and querying never block a frame.
 *
 * Not re-exported from src/core's barrel: importing it pulls supercluster in,
 * and that belongs in the worker chunk only.
 */

interface StoryProps {
  readonly row: number;
}

/** No reduce: membership comes from getLeaves, so clusters carry only supercluster's own fields. */
type Index = Supercluster<StoryProps, Record<never, never>>;
type IndexFeature = ClusterFeature<Record<never, never>> | PointFeature<StoryProps>;

const WORLD: [number, number, number, number] = [-180, -90, 180, 90];

export interface ClusterEngine {
  load(generation: number, columns: ClusterColumns): void;
  /**
   * Throws if nothing is loaded or `generation` is not the loaded one. Open, it
   * ignores `nowSec`: below PETAL_LEVEL every story is a pin, and at it every
   * level-8 cluster of all the stories is a sunflower.
   */
  layout(generation: number, level: number, nowSec: number, open?: boolean): ClusterLayout;
}

function isCluster(feature: IndexFeature): feature is ClusterFeature<Record<never, never>> {
  return 'cluster' in feature.properties;
}

/** Most members; a tie goes to the category with more total heat. */
function dominantCategory(columns: ClusterColumns, rows: readonly number[]): number {
  const members = new Array<number>(NEWS_CATEGORIES.length).fill(0);
  const heat = new Array<number>(NEWS_CATEGORIES.length).fill(0);
  for (const row of rows) {
    const category = columns.categories[row] ?? 0;
    const at = category < NEWS_CATEGORIES.length ? category : 0;
    members[at] = (members[at] ?? 0) + 1;
    heat[at] = (heat[at] ?? 0) + (columns.heat[row] ?? 0);
  }
  let best = 0;
  for (let at = 1; at < members.length; at++) {
    const more = (members[at] ?? 0) - (members[best] ?? 0);
    if (more > 0 || (more === 0 && (heat[at] ?? 0) > (heat[best] ?? 0))) best = at;
  }
  return best;
}

/** One cluster: an orb drawn by its lowest-id member, or at PETAL_LEVEL a sunflower of all of them. */
function writeGroup(
  out: LayoutColumns,
  columns: ClusterColumns,
  rows: number[],
  lon: number,
  lat: number,
  asPetals: boolean,
): void {
  let rep = rows[0] ?? 0;
  for (const row of rows) if ((columns.ids[row] ?? 0) < (columns.ids[rep] ?? 0)) rep = row;
  const category = dominantCategory(columns, rows);
  const centre = latLonToVec3({ lat, lon });

  // Hottest at the centre of the flower, then outwards; ids break ties so the
  // order is the same on every run.
  if (asPetals) {
    rows.sort(
      (a, b) =>
        (columns.heat[b] ?? 0) - (columns.heat[a] ?? 0) ||
        (columns.ids[a] ?? 0) - (columns.ids[b] ?? 0),
    );
  }
  rows.forEach((row, petal) => {
    out.roles[row] = asPetals
      ? CLUSTER_ROLE.petal
      : row === rep
        ? CLUSTER_ROLE.orb
        : CLUSTER_ROLE.hidden;
    out.groups[row] = rep;
    out.anchors[row * 3] = centre.x;
    out.anchors[row * 3 + 1] = centre.y;
    out.anchors[row * 3 + 2] = centre.z;
    out.counts[row] = Math.min(rows.length, 0xffff);
    out.categories[row] = category;
    out.petals[row] = asPetals ? petal : 0;
  });
}

export function createClusterEngine(): ClusterEngine {
  let columns: ClusterColumns | null = null;
  let loaded = -1;
  let lon = new Float64Array(0);
  let lat = new Float64Array(0);
  let index: Index | null = null;
  let indexedVisible = -1;

  const buildIndex = (nowSec: number, visible: number): Index => {
    if (index && indexedVisible === visible) return index;
    const stories = columns;
    const features: PointFeature<StoryProps>[] = [];
    if (stories) {
      for (let row = 0; row < stories.count; row++) {
        if (!isPublished(stories, row, nowSec)) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon[row] ?? 0, lat[row] ?? 0] },
          properties: { row },
        });
      }
    }
    index = new Supercluster<StoryProps, Record<never, never>>({
      radius: CLUSTER_RADIUS_PX,
      extent: CLUSTER_TILE_PX,
      minZoom: 0,
      maxZoom: CLUSTER_MAX_ZOOM,
    }).load(features);
    indexedVisible = visible;
    return index;
  };

  return {
    load(generation, next) {
      columns = next;
      loaded = generation;
      index = null;
      indexedVisible = -1;
      lon = new Float64Array(next.count);
      lat = new Float64Array(next.count);
      const { positions } = next;
      for (let row = 0; row < next.count; row++) {
        const at = vec3ToLatLon({
          x: positions[row * 3] ?? 0,
          y: positions[row * 3 + 1] ?? 0,
          z: positions[row * 3 + 2] ?? 0,
        });
        lon[row] = at.lon;
        lat[row] = at.lat;
      }
    },

    layout(generation, requestedLevel, nowSec, open = false) {
      if (!columns || generation !== loaded) {
        throw new Error(`layout for generation ${generation}, but ${loaded} is loaded`);
      }
      const level = Math.min(Math.max(Math.round(requestedLevel), 0), PETAL_LEVEL);
      const visible = countVisible(columns, nowSec);
      const out = createLayoutColumns(columns.count);
      const result = { generation, level, open, count: columns.count, visible, ...out };

      // Every row starts as its own pin. Clustered rows are rewritten below;
      // the rest are opened clusters or stories the shader keeps hidden until
      // their publish time.
      for (let row = 0; row < columns.count; row++) writePin(out, columns, row);
      if (open && level < PETAL_LEVEL) return result;

      const tree = open ? buildIndex(Infinity, columns.count) : buildIndex(nowSec, visible);
      for (const feature of tree.getClusters(WORLD, Math.min(level, CLUSTER_MAX_ZOOM))) {
        if (isCluster(feature)) {
          const rows = tree
            .getLeaves(feature.properties.cluster_id, Infinity)
            .map((leaf) => leaf.properties.row);
          const [clusterLon = 0, clusterLat = 0] = feature.geometry.coordinates;
          writeGroup(out, columns, rows, clusterLon, clusterLat, level === PETAL_LEVEL);
        } else {
          writePin(out, columns, feature.properties.row);
        }
      }
      return result;
    },
  };
}

export interface HandledRequest {
  readonly reply: ClusterReply;
  /** Buffers to transfer with the reply rather than copy. */
  readonly transfer: ArrayBuffer[];
}

/** The worker's whole job: loads answer nothing, layouts answer with a layout or an error. */
export function handleClusterRequest(
  engine: ClusterEngine,
  request: ClusterRequest,
): HandledRequest | null {
  if (request.type === 'load') {
    engine.load(request.generation, request.columns);
    return null;
  }
  try {
    const layout = engine.layout(request.generation, request.level, request.nowSec, request.open);
    return {
      reply: { type: 'layout', request: request.request, layout },
      transfer: layoutBuffers(layout),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reply: { type: 'error', request: request.request, message }, transfer: [] };
  }
}
