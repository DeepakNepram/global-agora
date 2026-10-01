/**
 * Outlet search's data (docs/DATA_SCHEMA.md, "Outlets"): which outlets cover
 * the globe's stories, and one outlet's stories. Both are over the payload's
 * own stories, so every id is one the globe has.
 *
 *   GET /api/outlets?hours=N           {v, generated_at, window_hours, outlets, n}
 *   GET /api/outlets/:outlet?hours=N   {outlet, ids}
 *
 * The API Worker validates what it serves with this file, and the client
 * validates again, as for the payload.
 */

import type { FetchLike } from './nodes';

export const OUTLETS_VERSION = 1;

export interface OutletsIndex {
  readonly v: typeof OUTLETS_VERSION;
  readonly generated_at: number;
  readonly window_hours: number;
  /** Outlet domains, most stories first. */
  readonly outlets: readonly string[];
  /** Stories each covers, in the same order. */
  readonly n: readonly number[];
}

export interface OutletStories {
  readonly outlet: string;
  /** Payload ids, newest first. */
  readonly ids: readonly number[];
}

export class OutletsError extends Error {
  override readonly name: string = 'OutletsError';
}

/**
 * An outlet as articles.outlet holds it: ingest writes a domain, the seed and
 * hand edits a name ("Tasman Record"). 1 to 120 characters, no control
 * characters; it travels percent-encoded in the path.
 */
export function isOutletName(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return value.length >= 1 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Checks a version-1 outlet index and returns it typed, without copying. */
export function parseOutletsIndex(value: unknown): OutletsIndex {
  if (!isRecord(value) || value['v'] !== OUTLETS_VERSION) {
    throw new OutletsError('not a version 1 outlet index');
  }
  const { generated_at: generatedAt, window_hours: windowHours, outlets, n } = value;
  if (typeof generatedAt !== 'number' || !Number.isInteger(generatedAt) || generatedAt < 0) {
    throw new OutletsError('generated_at must be whole epoch seconds');
  }
  if (typeof windowHours !== 'number' || !Number.isInteger(windowHours) || windowHours < 1) {
    throw new OutletsError('window_hours must be a positive integer');
  }
  if (!Array.isArray(outlets) || !outlets.every((name) => typeof name === 'string')) {
    throw new OutletsError('outlets must be names');
  }
  if (!Array.isArray(n) || n.length !== outlets.length || !n.every(isCount)) {
    throw new OutletsError('n must hold a story count per outlet');
  }
  return value as unknown as OutletsIndex;
}

export function parseOutletStories(value: unknown): OutletStories {
  if (!isRecord(value) || typeof value['outlet'] !== 'string') {
    throw new OutletsError('not an outlet story list');
  }
  const ids = value['ids'];
  if (!Array.isArray(ids) || !ids.every((id) => Number.isSafeInteger(id) && (id as number) > 0)) {
    throw new OutletsError('ids must be payload ids');
  }
  return { outlet: value['outlet'], ids: ids as number[] };
}

export function outletsUrl(baseUrl: string, hours: number): string {
  return `${baseUrl}/outlets?hours=${hours}`;
}

export function outletStoriesUrl(baseUrl: string, outlet: string, hours: number): string {
  return `${baseUrl}/outlets/${encodeURIComponent(outlet)}?hours=${hours}`;
}

interface FetchOptions {
  readonly fetch?: FetchLike;
  readonly signal?: AbortSignal;
}

async function getJson(url: string, options: FetchOptions): Promise<unknown> {
  const fetchFn = options.fetch ?? fetch;
  const response = await fetchFn(url, options.signal ? { signal: options.signal } : {});
  if (!response.ok) throw new OutletsError(`outlets: HTTP ${response.status}`);
  return response.json();
}

export async function fetchOutlets(
  baseUrl: string,
  hours: number,
  options: FetchOptions = {},
): Promise<OutletsIndex> {
  return parseOutletsIndex(await getJson(outletsUrl(baseUrl, hours), options));
}

export async function fetchOutletStories(
  baseUrl: string,
  outlet: string,
  hours: number,
  options: FetchOptions = {},
): Promise<OutletStories> {
  return parseOutletStories(await getJson(outletStoriesUrl(baseUrl, outlet, hours), options));
}
