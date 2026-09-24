import { describe, expect, it } from 'vitest';

import { latLonToVec3 } from '../geo';
import { NEWS_CATEGORIES } from '../nodeBuffer';

import { decodeNodes, fetchNodes, nodesUrl, NodesFetchError, type FetchLike } from './nodes';
import { dequantizeLat, dequantizeLon, PayloadError } from './payload';
import { samplePayload } from './payload.fixture';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', etag: 'W/"1-abc"' },
    ...init,
  });
}

/** A fetch that records each call and answers with `respond`. */
function fakeFetch(
  respond: () => Response,
): FetchLike & { calls: [string, RequestInit | undefined][] } {
  const calls: [string, RequestInit | undefined][] = [];
  const fn = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push([input, init]);
    return respond();
  };
  return Object.assign(fn, { calls });
}

describe('decodeNodes', () => {
  it('writes every column into typed arrays', () => {
    const nodes = decodeNodes(samplePayload());
    expect(nodes.count).toBe(3);
    expect(nodes.positions).toBeInstanceOf(Float32Array);
    expect(nodes.publishedSec).toBeInstanceOf(Int32Array);
    expect(Array.from(nodes.publishedSec)).toEqual([0, 43_200, 86_400]);
    expect(Array.from(nodes.ids)).toEqual([101, 102, 103]);
    expect(Array.from(nodes.heat)).toEqual([255, 120, 10]);
    expect(Array.from(nodes.sourceCounts)).toEqual([48, 5, 1]);
    expect(Array.from(nodes.discussionOpen)).toEqual([1, 0, 0]);
    expect(nodes.headlines).toEqual([
      'Vote nears in London',
      'Shares slide in Tokyo',
      'Ice shelf calves',
    ]);
    expect(nodes.places).toEqual(['London, United Kingdom', 'Tokyo, Japan', '']);
  });

  it('puts the window start at generated_at minus the window', () => {
    const nodes = decodeNodes(samplePayload());
    expect(nodes.epochSec).toBe(1_790_000_000 - 24 * 3600);
  });

  it('places each node where latLonToVec3 puts its dequantized coordinates', () => {
    const payload = samplePayload();
    const nodes = decodeNodes(payload);
    for (let i = 0; i < nodes.count; i++) {
      const expected = latLonToVec3({
        lat: dequantizeLat(payload.nodes.latQ[i] ?? 0),
        lon: dequantizeLon(payload.nodes.lonQ[i] ?? 0),
      });
      expect(nodes.positions[i * 3]).toBeCloseTo(expected.x, 6);
      expect(nodes.positions[i * 3 + 1]).toBeCloseTo(expected.y, 6);
      expect(nodes.positions[i * 3 + 2]).toBeCloseTo(expected.z, 6);
    }
  });

  it('maps categories by name, so an unknown one shows as world', () => {
    const payload = samplePayload();
    const reordered = {
      ...payload,
      categories: ['tech', 'politics', 'future-category', 'business'],
      nodes: { ...payload.nodes, cat: [0, 1, 2] },
    };
    const nodes = decodeNodes(reordered);
    expect(Array.from(nodes.categories)).toEqual([
      NEWS_CATEGORIES.indexOf('tech'),
      NEWS_CATEGORIES.indexOf('politics'),
      0,
    ]);
  });
});

describe('fetchNodes', () => {
  it('requests the window from the API base and decodes the reply', async () => {
    const fetch = fakeFetch(() => jsonResponse(samplePayload()));
    const result = await fetchNodes({ baseUrl: '/api/', hours: 24, fetch });
    expect(fetch.calls[0]?.[0]).toBe('/api/nodes?hours=24');
    expect(result.status).toBe('updated');
    expect(result.etag).toBe('W/"1-abc"');
    if (result.status === 'updated') expect(result.nodes.count).toBe(3);
  });

  it('asks conditionally and treats 304 as unchanged', async () => {
    const fetch = fakeFetch(() => new Response(null, { status: 304 }));
    const result = await fetchNodes({ baseUrl: '/api', hours: 24, fetch, etag: 'W/"1-abc"' });
    const headers = fetch.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['if-none-match']).toBe('W/"1-abc"');
    expect(result).toEqual({ status: 'unchanged', etag: 'W/"1-abc"' });
  });

  it('skips the decode when a cache answers 200 with the same ETag', async () => {
    const fetch = fakeFetch(() => jsonResponse({ not: 'even parsed' }));
    const result = await fetchNodes({ baseUrl: '/api', hours: 24, fetch, etag: 'W/"1-abc"' });
    expect(result.status).toBe('unchanged');
  });

  it('reports HTTP and network failures with a status', async () => {
    const failing = fakeFetch(() => new Response('nope', { status: 503 }));
    await expect(fetchNodes({ baseUrl: '/api', hours: 24, fetch: failing })).rejects.toEqual(
      new NodesFetchError('HTTP 503', 503),
    );
    const offline: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    const error = await fetchNodes({ baseUrl: '/api', hours: 24, fetch: offline }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NodesFetchError);
    expect((error as NodesFetchError).status).toBe(0);
  });

  it('refuses a malformed payload rather than drawing it', async () => {
    const fetch = fakeFetch(() => jsonResponse({ ...samplePayload(), v: 9 }));
    await expect(fetchNodes({ baseUrl: '/api', hours: 24, fetch })).rejects.toBeInstanceOf(
      PayloadError,
    );
  });

  it('lets an abort through as an abort', async () => {
    const aborting: FetchLike = async () => {
      throw new DOMException('aborted', 'AbortError');
    };
    await expect(fetchNodes({ baseUrl: '/api', hours: 24, fetch: aborting })).rejects.toMatchObject(
      { name: 'AbortError' },
    );
  });

  it('builds the URL without doubling slashes', () => {
    expect(nodesUrl('https://example.com/api/', 168)).toBe(
      'https://example.com/api/nodes?hours=168',
    );
  });
});
