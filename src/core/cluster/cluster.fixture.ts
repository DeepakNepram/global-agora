import { latLonToVec3 } from '../geo';
import { createNodeBuffer, type NodeBuffer } from '../nodeBuffer';

/** Test stories: a handful of hand-placed rows instead of a seeded mock. */

export interface StorySpec {
  readonly id: number;
  readonly lat: number;
  readonly lon: number;
  readonly heat?: number;
  readonly category?: number;
  /** Seconds after the window start; 0 by default. */
  readonly t?: number;
}

export const FIXTURE_EPOCH_SEC = 1_790_000_000;

export function storyBuffer(specs: readonly StorySpec[]): NodeBuffer {
  const nodes = createNodeBuffer(specs.length);
  nodes.count = specs.length;
  nodes.epochSec = FIXTURE_EPOCH_SEC;
  specs.forEach((spec, row) => {
    const at = latLonToVec3({ lat: spec.lat, lon: spec.lon });
    nodes.positions[row * 3] = at.x;
    nodes.positions[row * 3 + 1] = at.y;
    nodes.positions[row * 3 + 2] = at.z;
    nodes.ids[row] = spec.id;
    nodes.heat[row] = spec.heat ?? 100;
    nodes.categories[row] = spec.category ?? 0;
    nodes.publishedSec[row] = spec.t ?? 0;
    nodes.headlines[row] = `Story ${spec.id}`;
  });
  return nodes;
}

/** `count` stories stacked at one place, ids from `firstId`, heat falling with the id. */
export function stack(count: number, lat: number, lon: number, firstId: number): StorySpec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: firstId + i,
    lat,
    lon,
    heat: 200 - i,
  }));
}
