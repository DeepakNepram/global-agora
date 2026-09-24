/**
 * Builds the two cacheable responses from the database: the nodes payload and
 * one story. Each returns a CacheEntry, the unit the SWR cache stores.
 */

import { PAYLOAD_VERSION, parseNodesPayload } from '../../../src/core/data/payload.ts';
import { NEWS_CATEGORIES } from '../../../src/core/nodeBuffer.ts';

import { GoneError, type CacheEntry } from './cache.ts';
import { brotli } from './compress.ts';
import { DbError, type ApiDb, type StoryRef } from './db.ts';

export const JSON_TYPE = 'application/json; charset=utf-8';

const encoder = new TextEncoder();

/**
 * A weak validator from the bytes a client would decode: weak because the
 * same content is served Brotli or identity, which a strong ETag would have to
 * tell apart.
 */
export async function weakEtag(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `W/"${hex}"`;
}

export interface NodesBuild {
  readonly db: ApiDb;
  readonly hours: number;
  readonly limit: number;
  readonly brotliQuality: number;
  readonly now: () => number;
}

/**
 * The payload for one window. api_nodes gets the previous hash, and when the
 * data is unchanged it answers with the hash alone: the entry is re-timed
 * without fetching or compressing anything.
 *
 * Otherwise the database's columns are wrapped in the version-1 envelope,
 * validated with the same code the client uses, and compressed once.
 */
export async function buildNodes(
  build: NodesBuild,
  previous: CacheEntry | null,
): Promise<CacheEntry> {
  const result = await build.db.nodes(build.hours, build.limit, previous?.sourceHash ?? null);
  if (result.payload === undefined) {
    if (previous === null || previous.sourceHash !== result.hash) {
      throw new DbError('api_nodes returned no payload for an unknown hash');
    }
    return { ...previous, checkedAt: build.now() };
  }

  const columns = result.payload as {
    generated_at?: unknown;
    window_hours?: unknown;
    nodes?: unknown;
  };
  // Key order is the documented order (docs/DATA_SCHEMA.md).
  const payload = parseNodesPayload({
    v: PAYLOAD_VERSION,
    generated_at: columns.generated_at,
    window_hours: columns.window_hours,
    categories: NEWS_CATEGORIES,
    nodes: columns.nodes,
  });
  if (payload.window_hours !== build.hours) {
    throw new DbError(`api_nodes answered ${payload.window_hours} h for ${build.hours} h`);
  }

  const json = encoder.encode(JSON.stringify(payload));
  return {
    body: brotli(json, build.brotliQuality),
    encoding: 'br',
    contentType: JSON_TYPE,
    etag: await weakEtag(json),
    sourceHash: result.hash,
    checkedAt: build.now(),
  };
}

export interface StoryBuild {
  readonly db: ApiDb;
  readonly ref: StoryRef;
  readonly articleLimit: number;
  readonly now: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One story in full, as api_story builds it, with the category index turned
 * into its name. Small enough that Cloudflare's own compression is fine.
 */
export async function buildStory(build: StoryBuild): Promise<CacheEntry> {
  const story = await build.db.story(build.ref, build.articleLimit);
  if (story === null) throw new GoneError('no such story');
  if (!isRecord(story) || typeof story['id'] !== 'string' || !Array.isArray(story['articles'])) {
    throw new DbError('api_story returned an unexpected shape');
  }
  const category = typeof story['category'] === 'number' ? story['category'] : 0;
  const json = encoder.encode(
    JSON.stringify({ ...story, category: NEWS_CATEGORIES[category] ?? NEWS_CATEGORIES[0] }),
  );
  const etag = await weakEtag(json);
  return {
    body: json,
    encoding: 'identity',
    contentType: JSON_TYPE,
    etag,
    sourceHash: etag,
    checkedAt: build.now(),
  };
}
