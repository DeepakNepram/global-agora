/**
 * The admin console's flat map (Prompt 4.6): the globe's equirectangular day
 * texture in a 2:1 frame, zoomed and panned. Pure math, no DOM: the view is
 * a centre and a zoom, and every pixel maps to one coordinate and back.
 *
 * At zoom z the frame spans 360/z degrees of longitude across its width and
 * 180/z of latitude down its height, so a degree is as wide as it is tall:
 *   lon = centre.lon + (x / width  - 1/2) * 360 / z
 *   lat = centre.lat - (y / height - 1/2) * 180 / z
 */

import type { LatLon } from './geo';

export interface MapView {
  readonly lat: number;
  readonly lon: number;
  readonly zoom: number;
}

export interface MapPoint {
  readonly x: number;
  readonly y: number;
}

export interface MapSize {
  readonly width: number;
  readonly height: number;
}

export const MIN_ZOOM = 1;
/** A 4096-texel map at 32×: a texel is ~0.3 km, finer than any pin needs. */
export const MAX_ZOOM = 32;

export const WORLD_VIEW: MapView = { lat: 0, lon: 0, zoom: 1 };

/** The view kept on the map: zoom in range, and no edge pulled past the world's. */
export function clampView(view: MapView): MapView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom));
  const halfLon = 180 / zoom;
  const halfLat = 90 / zoom;
  return {
    zoom,
    lon: Math.min(180 - halfLon, Math.max(-180 + halfLon, view.lon)),
    lat: Math.min(90 - halfLat, Math.max(-90 + halfLat, view.lat)),
  };
}

export function pointToLatLon(view: MapView, point: MapPoint, size: MapSize): LatLon {
  return {
    lat: Math.min(90, Math.max(-90, view.lat - (point.y / size.height - 0.5) * (180 / view.zoom))),
    lon: Math.min(180, Math.max(-180, view.lon + (point.x / size.width - 0.5) * (360 / view.zoom))),
  };
}

export function latLonToPoint(view: MapView, at: LatLon, size: MapSize): MapPoint {
  return {
    x: (((at.lon - view.lon) * view.zoom) / 360) * size.width + size.width / 2,
    y: (((view.lat - at.lat) * view.zoom) / 180) * size.height + size.height / 2,
  };
}

/** Zooms by `factor` about `point`, which stays over the same place. */
export function zoomAt(view: MapView, factor: number, point: MapPoint, size: MapSize): MapView {
  const anchor = pointToLatLon(view, point, size);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  // Solve the projection for the centre that puts `anchor` back at `point`.
  return clampView({
    zoom,
    lon: anchor.lon - (point.x / size.width - 0.5) * (360 / zoom),
    lat: anchor.lat + (point.y / size.height - 0.5) * (180 / zoom),
  });
}

/** Moves the map with a drag of (dx, dy) pixels. */
export function panBy(view: MapView, dx: number, dy: number, size: MapSize): MapView {
  return clampView({
    zoom: view.zoom,
    lon: view.lon - (dx / size.width) * (360 / view.zoom),
    lat: view.lat + (dy / size.height) * (180 / view.zoom),
  });
}

/** Centred on `at`, as near as the edges allow. */
export function viewAt(at: LatLon, zoom: number): MapView {
  return clampView({ lat: at.lat, lon: at.lon, zoom });
}

/** A rectangle of the texture, in its own texels. */
export interface TextureRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The part of an equirectangular texture (`texture` texels, north up, the
 * antimeridian at both edges) the view shows: what a canvas draws, scaled to
 * fill the frame. Only the visible texels are ever drawn, at any zoom.
 */
export function sourceRect(view: MapView, texture: MapSize): TextureRect {
  return {
    x: ((view.lon - 180 / view.zoom + 180) / 360) * texture.width,
    y: ((90 - (view.lat + 90 / view.zoom)) / 180) * texture.height,
    width: texture.width / view.zoom,
    height: texture.height / view.zoom,
  };
}

/** An arrow key's nudge: a two-hundredth of the frame's width, in degrees. */
export function nudgeDegrees(view: MapView): number {
  return 360 / view.zoom / 200;
}

/** The pin moved by whole nudges (east and north are positive), kept on Earth. */
export function nudge(at: LatLon, view: MapView, east: number, north: number): LatLon {
  const step = nudgeDegrees(view);
  const lon = at.lon + east * step;
  return {
    lat: Math.min(90, Math.max(-90, at.lat + north * step)),
    // Past the antimeridian, back round the other side.
    lon: lon > 180 ? lon - 360 : lon < -180 ? lon + 360 : lon,
  };
}
