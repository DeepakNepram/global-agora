import { describe, expect, it } from 'vitest';

import {
  clampFlat,
  flatPanBy,
  flatProject,
  flatUnproject,
  flatZoomAt,
  minFlatScale,
  textureSpans,
  wrapLon,
} from './flatMap';

const size = { width: 800, height: 400 };
const point = { x: 0, y: 0 };

describe('flat map', () => {
  it('wraps longitude into [−180, 180)', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(180)).toBe(-180);
    expect(wrapLon(45)).toBe(45);
  });

  it('covers the frame at the smallest scale: a phone sees the full height, a wide screen the full width', () => {
    expect(minFlatScale({ width: 390, height: 844 })).toBeCloseTo(844 / 180, 9);
    expect(minFlatScale({ width: 1440, height: 600 })).toBeCloseTo(4, 9);
  });

  it('projects and unprojects every pixel back to itself', () => {
    const view = { lat: 20, lon: 100, scale: 8 };
    for (const [x, y] of [
      [0, 0],
      [400, 200],
      [799, 399],
      [123, 321],
    ] as const) {
      const at = flatUnproject(view, size, x, y);
      flatProject(view, size, at.lat, at.lon, point);
      expect(point.x).toBeCloseTo(x, 6);
      expect(point.y).toBeCloseTo(y, 6);
    }
  });

  it('draws a place across the antimeridian on the side nearest the centre', () => {
    const view = { lat: 0, lon: 175, scale: 10 };
    flatProject(view, size, 0, -175, point);
    expect(point.x).toBeCloseTo(400 + 100, 6);
  });

  it('keeps the poles at the frame edges and the scale in range', () => {
    const clamped = clampFlat({ lat: 89, lon: 0, scale: 10 }, size, 100);
    expect(clamped.lat).toBeCloseTo(90 - 200 / 10, 9);
    expect(clampFlat({ lat: 0, lon: 0, scale: 0.1 }, size, 100).scale).toBe(minFlatScale(size));
    expect(clampFlat({ lat: 0, lon: 0, scale: 500 }, size, 100).scale).toBe(100);
  });

  it('zooms about a point, which stays over the same place', () => {
    const view = { lat: 10, lon: 20, scale: 6 };
    const before = flatUnproject(view, size, 600, 120);
    const after = flatZoomAt(view, size, 2, { x: 600, y: 120 }, 1000);
    expect(after.scale).toBe(12);
    const again = flatUnproject(after, size, 600, 120);
    expect(again.lat).toBeCloseTo(before.lat, 9);
    expect(again.lon).toBeCloseTo(before.lon, 9);
  });

  it('pans with a drag, and across the antimeridian', () => {
    const view = flatPanBy({ lat: 0, lon: 178, scale: 10 }, size, -50, 0, 1000);
    expect(view.lon).toBeCloseTo(-177, 9);
  });

  it('splits the texture at the antimeridian and fills the frame width', () => {
    const texture = { width: 3600, height: 1800 };
    const one = textureSpans({ lat: 0, lon: 0, scale: 10 }, size, texture);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ sx: 1400, sw: 800, dx: 0, dw: 800, sy: 700, sh: 400 });
    const two = textureSpans({ lat: 0, lon: 178, scale: 10 }, size, texture);
    expect(two).toHaveLength(2);
    // 80° wide from 138°E: 42° to the antimeridian, then 38° on from −180°.
    expect(two[0]?.sx).toBeCloseTo(3180, 6);
    expect(two[0]?.dw).toBeCloseTo(420, 6);
    expect((two[0]?.dw ?? 0) + (two[1]?.dw ?? 0)).toBeCloseTo(800, 6);
    expect(two[1]?.sx).toBeCloseTo(0, 6);
  });
});
