import { NEWS_CATEGORIES, createNodeBuffer, type NodeBuffer } from '../nodeBuffer';

import { COORD_SCALE, parseNodesPayload, type NodesPayload } from './payload';

/**
 * Loads the globe's stories from GET /api/nodes and decodes them straight into
 * a NodeBuffer: one pass per node writing typed arrays, no object per story,
 * so the result goes to the pin layer's updateInstances as it is.
 */

const DEG_TO_RAD = Math.PI / 180;

/** The subset of fetch this module uses, so tests and a native shell can supply their own. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FetchNodesOptions {
  /** AppConfig.apiBaseUrl, e.g. "/api". */
  readonly baseUrl: string;
  /** AppConfig.historyWindowHours: a tier value, never a literal. */
  readonly hours: number;
  readonly fetch: FetchLike;
  readonly signal?: AbortSignal;
  /** The ETag of the payload already decoded; a match costs a 304 and no decode. */
  readonly etag?: string | null;
}

export type FetchNodesResult =
  | { readonly status: 'unchanged'; readonly etag: string | null }
  | { readonly status: 'updated'; readonly etag: string | null; readonly nodes: NodeBuffer };

export class NodesFetchError extends Error {
  override readonly name = 'NodesFetchError';
  constructor(
    message: string,
    /** HTTP status, or 0 when no response arrived. */
    readonly status: number,
  ) {
    super(message);
  }
}

export function nodesUrl(baseUrl: string, hours: number): string {
  return `${baseUrl.replace(/\/+$/, '')}/nodes?hours=${hours}`;
}

/**
 * For each of the payload's category indexes, ours. Matching by name keeps an
 * older client correct when the server appends a category: it shows as world.
 */
function categoryMap(names: readonly string[]): Uint8Array {
  const ours: readonly string[] = NEWS_CATEGORIES;
  return Uint8Array.from(names, (name) => Math.max(0, ours.indexOf(name)));
}

/**
 * Writes a validated payload into a new NodeBuffer.
 *
 * Positions follow latLonToVec3 (src/core/geo.ts) on the unit sphere, inlined
 * so the loop allocates nothing:
 *   phi = (lon + 180)°, theta = (90 - lat)°
 *   x = -sin(theta)·cos(phi), y = cos(theta), z = sin(theta)·sin(phi)
 */
export function decodeNodes(payload: NodesPayload): NodeBuffer {
  const { id, lonQ, latQ, t, cat, heat, srcN, disc, hl, pl } = payload.nodes;
  const count = id.length;
  const buffer = createNodeBuffer(count);
  const categories = categoryMap(payload.categories);
  const { positions } = buffer;

  buffer.count = count;
  buffer.epochSec = payload.generated_at - payload.window_hours * 3600;

  for (let i = 0; i < count; i++) {
    const lat = ((latQ[i] ?? 0) / COORD_SCALE) * 90;
    const lon = ((lonQ[i] ?? 0) / COORD_SCALE) * 180;
    const phi = (lon + 180) * DEG_TO_RAD;
    const theta = (90 - lat) * DEG_TO_RAD;
    const ring = Math.sin(theta);
    positions[i * 3] = -ring * Math.cos(phi);
    positions[i * 3 + 1] = Math.cos(theta);
    positions[i * 3 + 2] = ring * Math.sin(phi);

    buffer.publishedSec[i] = t[i] ?? 0;
    buffer.categories[i] = categories[cat[i] ?? 0] ?? 0;
    buffer.heat[i] = heat[i] ?? 0;
    buffer.ids[i] = id[i] ?? 0;
    buffer.sourceCounts[i] = srcN[i] ?? 0;
    buffer.discussionOpen[i] = disc[i] ?? 0;
    buffer.headlines[i] = hl[i] ?? '';
    buffer.places[i] = pl[i] ?? '';
  }
  return buffer;
}

/**
 * Fetches and decodes the payload. With `etag`, the request is conditional and
 * an unchanged payload comes back as a bodiless 304: set by hand rather than
 * left to the browser cache, which behaves the same in every runtime.
 */
export async function fetchNodes(options: FetchNodesOptions): Promise<FetchNodesResult> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.etag) headers['if-none-match'] = options.etag;

  let response: Response;
  try {
    response = await options.fetch(nodesUrl(options.baseUrl, options.hours), {
      headers,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new NodesFetchError(`network error: ${String(error)}`, 0);
  }

  const etag = response.headers.get('etag');
  if (response.status === 304) return { status: 'unchanged', etag: etag ?? options.etag ?? null };
  if (!response.ok) throw new NodesFetchError(`HTTP ${response.status}`, response.status);
  // A cache in between may answer 200 with the same bytes; skip the decode.
  if (etag !== null && etag === options.etag) return { status: 'unchanged', etag };

  const payload = parseNodesPayload(await response.json());
  return { status: 'updated', etag, nodes: decodeNodes(payload) };
}
