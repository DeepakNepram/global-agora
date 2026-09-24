import { describe, expect, it } from 'vitest';

import {
  COORD_SCALE,
  dequantizeLat,
  dequantizeLon,
  parseNodesPayload,
  PayloadError,
  quantizeLat,
  quantizeLon,
} from './payload';
import { samplePayload } from './payload.fixture';

function withNodes(changes: Record<string, unknown>): unknown {
  const payload = samplePayload();
  return { ...payload, nodes: { ...payload.nodes, ...changes } };
}

describe('fixed-point coordinates', () => {
  it('maps the ends of each range to ±32767', () => {
    expect(quantizeLon(180)).toBe(COORD_SCALE);
    expect(quantizeLon(-180)).toBe(-COORD_SCALE);
    expect(quantizeLat(90)).toBe(COORD_SCALE);
    expect(quantizeLat(-90)).toBe(-COORD_SCALE);
    expect(quantizeLon(0)).toBe(0);
  });

  it('round-trips within half a step (under 310 m at the equator)', () => {
    for (const lon of [-179.99, -74.006, -0.1278, 2.3522, 77.209, 151.2093]) {
      expect(Math.abs(dequantizeLon(quantizeLon(lon)) - lon)).toBeLessThanOrEqual(90 / COORD_SCALE);
    }
    for (const lat of [-33.8688, 0.0001, 28.6139, 51.5074, 89.9]) {
      expect(Math.abs(dequantizeLat(quantizeLat(lat)) - lat)).toBeLessThanOrEqual(45 / COORD_SCALE);
    }
  });
});

describe('parseNodesPayload', () => {
  it('accepts a well-formed payload and returns it as is', () => {
    const payload = samplePayload();
    expect(parseNodesPayload(payload)).toBe(payload);
  });

  it('accepts an empty window', () => {
    const empty = withNodes({
      id: [],
      lonQ: [],
      latQ: [],
      t: [],
      cat: [],
      heat: [],
      srcN: [],
      disc: [],
      hl: [],
      pl: [],
    });
    expect(parseNodesPayload(empty).nodes.id).toHaveLength(0);
  });

  it('refuses an unknown version', () => {
    expect(() => parseNodesPayload({ ...samplePayload(), v: 2 })).toThrow(/version 2/);
  });

  it('refuses columns of different lengths', () => {
    expect(() => parseNodesPayload(withNodes({ hl: ['only one'] }))).toThrow(
      /nodes.hl has 1 entries/,
    );
  });

  it.each([
    ['lonQ', [0, 0, 40_000]],
    ['latQ', [0, -40_000, 0]],
    ['t', [0, 0, 86_401]],
    ['t', [-1, 0, 0]],
    ['cat', [0, 0, 8]],
    ['heat', [0, 256, 0]],
    ['disc', [0, 2, 0]],
    ['id', [0, 1, 2]],
    ['heat', [0, 1.5, 0]],
    ['srcN', [0, '3', 0]],
  ])('refuses %s = %j', (column, values) => {
    expect(() => parseNodesPayload(withNodes({ [column]: values }))).toThrow(PayloadError);
  });

  it('refuses non-text headlines and malformed envelopes', () => {
    expect(() => parseNodesPayload(withNodes({ hl: ['a', null, 'c'] }))).toThrow(/hl\[1\]/);
    expect(() => parseNodesPayload(null)).toThrow(PayloadError);
    expect(() => parseNodesPayload([])).toThrow(PayloadError);
    expect(() => parseNodesPayload({ ...samplePayload(), window_hours: 0 })).toThrow(PayloadError);
    expect(() => parseNodesPayload({ ...samplePayload(), categories: [] })).toThrow(PayloadError);
    expect(() => parseNodesPayload({ ...samplePayload(), nodes: [] })).toThrow(PayloadError);
  });
});
