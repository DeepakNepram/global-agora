/**
 * The story nodes the globe draws, as columns of typed arrays.
 *
 * This is the in-memory shape of the build plan's columnar payload (§3): Prompt
 * 2.3 decodes the payload straight into it, and the pin renderer reads it
 * without an intermediate object per story. Arrays are sized by capacity and
 * `count` says how many rows are live, so a refresh can reuse the same memory.
 */

/**
 * Fixed category list. The payload sends category as an index into this array,
 * so the order is part of the wire format: append only, never reorder.
 */
export const NEWS_CATEGORIES = [
  'world',
  'conflict',
  'politics',
  'business',
  'science',
  'climate',
  'tech',
  'health',
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export interface NodeBuffer {
  /** Live rows. Every array holds at least this many; the rest is spare capacity. */
  count: number;
  /**
   * Window start in epoch seconds. `publishedSec` counts from here, which keeps
   * the times small enough for Int32Array and matches the payload's `t`.
   */
  epochSec: number;
  /** Unit-sphere position per node, xyz, in the Earth-fixed frame of latLonToVec3. */
  readonly positions: Float32Array;
  /** Publish time per node, seconds after epochSec. */
  readonly publishedSec: Int32Array;
  /** Index into NEWS_CATEGORIES per node. */
  readonly categories: Uint8Array;
  /** 0–255 per node (build plan: source count, diversity, velocity). */
  readonly heat: Uint8Array;
}

export function nodeBufferCapacity(buffer: NodeBuffer): number {
  return buffer.heat.length;
}

export function createNodeBuffer(capacity: number): NodeBuffer {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError(`capacity must be a non-negative integer, got ${capacity}`);
  }
  return {
    count: 0,
    epochSec: 0,
    positions: new Float32Array(capacity * 3),
    publishedSec: new Int32Array(capacity),
    categories: new Uint8Array(capacity),
    heat: new Uint8Array(capacity),
  };
}
