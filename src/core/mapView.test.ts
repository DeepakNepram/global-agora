import { describe, expect, it } from 'vitest';

import {
  clampView,
  latLonToPoint,
  MAX_ZOOM,
  nudge,
  panBy,
  pointToLatLon,
  sourceRect,
  viewAt,
  WORLD_VIEW,
  zoomAt,
} from './mapView';

const SIZE = { width: 800, height: 400 };

describe('the projection', () => {
  it('fits the whole world at zoom 1', () => {
    expect(pointToLatLon(WORLD_VIEW, { x: 0, y: 0 }, SIZE)).toEqual({ lat: 90, lon: -180 });
    expect(pointToLatLon(WORLD_VIEW, { x: 400, y: 200 }, SIZE)).toEqual({ lat: 0, lon: 0 });
    expect(pointToLatLon(WORLD_VIEW, { x: 800, y: 400 }, SIZE)).toEqual({ lat: -90, lon: 180 });
  });

  it('maps a place to a pixel and back at any zoom', () => {
    const bengaluru = { lat: 12.97, lon: 77.59 };
    for (const zoom of [1, 3, 17, MAX_ZOOM]) {
      const view = viewAt(bengaluru, zoom);
      const point = latLonToPoint(view, bengaluru, SIZE);
      const back = pointToLatLon(view, point, SIZE);
      expect(back.lat).toBeCloseTo(bengaluru.lat, 9);
      expect(back.lon).toBeCloseTo(bengaluru.lon, 9);
    }
  });

  it('draws the whole texture at zoom 1, and just the frame’s part when zoomed', () => {
    const texture = { width: 4096, height: 2048 };
    expect(sourceRect(WORLD_VIEW, texture)).toEqual({ x: 0, y: 0, width: 4096, height: 2048 });
    const view = viewAt({ lat: 40, lon: -74 }, 4);
    const rect = sourceRect(view, texture);
    // The frame's top-left corner, as a texel of the texture.
    const corner = pointToLatLon(view, { x: 0, y: 0 }, SIZE);
    expect(rect.x).toBeCloseTo(((corner.lon + 180) / 360) * 4096, 9);
    expect(rect.y).toBeCloseTo(((90 - corner.lat) / 180) * 2048, 9);
    expect(rect).toMatchObject({ width: 1024, height: 512 });
  });
});

describe('moving the map', () => {
  it('never shows past the world’s edge, nor zooms out of range', () => {
    expect(clampView({ lat: 89, lon: 179, zoom: 2 })).toEqual({ lat: 45, lon: 90, zoom: 2 });
    expect(clampView({ lat: 0, lon: 0, zoom: 0.2 }).zoom).toBe(1);
    expect(clampView({ lat: 0, lon: 0, zoom: 1000 }).zoom).toBe(MAX_ZOOM);
  });

  it('zooms about the cursor, which stays over the same place', () => {
    const cursor = { x: 610, y: 150 };
    const under = pointToLatLon(WORLD_VIEW, cursor, SIZE);
    const zoomed = zoomAt(WORLD_VIEW, 4, cursor, SIZE);
    const after = pointToLatLon(zoomed, cursor, SIZE);
    expect(zoomed.zoom).toBe(4);
    expect(after.lat).toBeCloseTo(under.lat, 9);
    expect(after.lon).toBeCloseTo(under.lon, 9);
  });

  it('drags the map with the pointer', () => {
    const view = viewAt({ lat: 0, lon: 0 }, 4);
    const dragged = panBy(view, 100, -50, SIZE);
    expect(dragged.lon).toBeCloseTo((-100 / 800) * 90, 9);
    expect(dragged.lat).toBeCloseTo((-50 / 400) * 45, 9);
  });
});

describe('nudge', () => {
  it('moves by a two-hundredth of the frame, finer as the map zooms in', () => {
    const at = { lat: 10, lon: 20 };
    expect(nudge(at, WORLD_VIEW, 1, 0)).toEqual({ lat: 10, lon: 21.8 });
    const fine = nudge(at, viewAt(at, 30), 0, -1);
    expect(fine.lat).toBeCloseTo(10 - 0.06, 9);
  });

  it('wraps at the antimeridian and stops at the poles', () => {
    expect(nudge({ lat: 0, lon: 179.5 }, WORLD_VIEW, 1, 0).lon).toBeCloseTo(-178.7, 9);
    expect(nudge({ lat: 89.9, lon: 0 }, WORLD_VIEW, 0, 1).lat).toBe(90);
  });
});
