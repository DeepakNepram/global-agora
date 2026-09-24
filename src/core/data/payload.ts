/**
 * The columnar payload GET /api/nodes serves (docs/DATA_SCHEMA.md, "Client
 * payload"). The API Worker validates what the database built with this file
 * before it caches anything, and the client validates again before decoding,
 * so both ends agree on one definition.
 */

/** Bumped on any incompatible change; the client refuses versions it does not know. */
export const PAYLOAD_VERSION = 1;

/**
 * int16 fixed point: lonQ = round(lon / 180 * 32767), latQ = round(lat / 90 * 32767).
 * One step is 0.0055° of longitude (~610 m at the equator) and 0.0027° of
 * latitude, far finer than a city pin.
 */
export const COORD_SCALE = 32767;

/** One array per field, all the same length: node i is index i of each. */
export interface NodeColumns {
  /** stories.seq; GET /api/story/:id takes it. */
  readonly id: readonly number[];
  readonly lonQ: readonly number[];
  readonly latQ: readonly number[];
  /** Seconds after generated_at - window_hours * 3600. */
  readonly t: readonly number[];
  /** Index into the payload's own `categories`. */
  readonly cat: readonly number[];
  /** 0–255. */
  readonly heat: readonly number[];
  /** Distinct outlets covering the story. */
  readonly srcN: readonly number[];
  /** 1 when the story's discussion is open. */
  readonly disc: readonly number[];
  /** Headline. */
  readonly hl: readonly string[];
  /** Place name; empty when unknown. */
  readonly pl: readonly string[];
}

export interface NodesPayload {
  readonly v: typeof PAYLOAD_VERSION;
  /** Window end, epoch seconds: the newest story, not the time of the request. */
  readonly generated_at: number;
  readonly window_hours: number;
  readonly categories: readonly string[];
  readonly nodes: NodeColumns;
}

export class PayloadError extends Error {
  override readonly name = 'PayloadError';
}

export function quantizeLon(lon: number): number {
  return Math.round((lon / 180) * COORD_SCALE);
}

export function quantizeLat(lat: number): number {
  return Math.round((lat / 90) * COORD_SCALE);
}

export function dequantizeLon(lonQ: number): number {
  return (lonQ / COORD_SCALE) * 180;
}

export function dequantizeLat(latQ: number): number {
  return (latQ / COORD_SCALE) * 90;
}

const UINT32_MAX = 0xffffffff;

type IntColumn = 'id' | 'lonQ' | 'latQ' | 't' | 'cat' | 'heat' | 'srcN' | 'disc';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function intColumn(
  nodes: Record<string, unknown>,
  name: IntColumn,
  min: number,
  max: number,
): void {
  const column = nodes[name];
  if (!Array.isArray(column)) throw new PayloadError(`nodes.${name} is not an array`);
  for (let i = 0; i < column.length; i++) {
    const value: unknown = column[i];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new PayloadError(`nodes.${name}[${i}] = ${String(value)}, expected ${min}–${max}`);
    }
  }
}

function stringColumn(nodes: Record<string, unknown>, name: 'hl' | 'pl'): void {
  const column = nodes[name];
  if (!Array.isArray(column)) throw new PayloadError(`nodes.${name} is not an array`);
  for (let i = 0; i < column.length; i++) {
    if (typeof column[i] !== 'string') throw new PayloadError(`nodes.${name}[${i}] is not text`);
  }
}

/**
 * Checks `value` is a well-formed version-1 payload and returns it typed,
 * without copying. Throws PayloadError naming the first problem.
 */
export function parseNodesPayload(value: unknown): NodesPayload {
  if (!isRecord(value)) throw new PayloadError('payload is not an object');
  if (value['v'] !== PAYLOAD_VERSION) {
    throw new PayloadError(`unsupported payload version ${String(value['v'])}`);
  }
  const generatedAt = value['generated_at'];
  const windowHours = value['window_hours'];
  if (typeof generatedAt !== 'number' || !Number.isInteger(generatedAt) || generatedAt < 0) {
    throw new PayloadError('generated_at must be whole epoch seconds');
  }
  if (typeof windowHours !== 'number' || !Number.isInteger(windowHours) || windowHours < 1) {
    throw new PayloadError('window_hours must be a positive integer');
  }
  const categories = value['categories'];
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new PayloadError('categories must be a non-empty list');
  }
  if (!categories.every((name) => typeof name === 'string')) {
    throw new PayloadError('categories must be names');
  }
  const nodes = value['nodes'];
  if (!isRecord(nodes)) throw new PayloadError('nodes is not an object');

  intColumn(nodes, 'id', 1, UINT32_MAX);
  intColumn(nodes, 'lonQ', -COORD_SCALE, COORD_SCALE);
  intColumn(nodes, 'latQ', -COORD_SCALE, COORD_SCALE);
  intColumn(nodes, 't', 0, windowHours * 3600);
  intColumn(nodes, 'cat', 0, categories.length - 1);
  intColumn(nodes, 'heat', 0, 255);
  intColumn(nodes, 'srcN', 0, 0xffff);
  intColumn(nodes, 'disc', 0, 1);
  stringColumn(nodes, 'hl');
  stringColumn(nodes, 'pl');

  const count = (nodes['id'] as unknown[]).length;
  for (const name of ['lonQ', 'latQ', 't', 'cat', 'heat', 'srcN', 'disc', 'hl', 'pl']) {
    const length = (nodes[name] as unknown[]).length;
    if (length !== count) {
      throw new PayloadError(`nodes.${name} has ${length} entries, nodes.id has ${count}`);
    }
  }
  return value as unknown as NodesPayload;
}
