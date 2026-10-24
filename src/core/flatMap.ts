/**
 * The flat map shown under reduced motion (Prompt 5.1): equirectangular,
 * north up, a degree as wide as it is tall, and seamless east–west, so the
 * Pacific can be panned across. Pure math, no DOM: a view is a centre and a
 * scale (CSS pixels per degree), and every pixel maps to one place and back:
 *   x = width / 2 + wrap(lon − centre.lon) · s
 *   y = height / 2 − (lat − centre.lat) · s
 * The smallest scale covers the frame (the larger of width / 360 and
 * height / 180), so the world never shows twice and never leaves a band.
 */

import type { LatLon } from './geo';

export interface FlatView {
  readonly lat: number;
  readonly lon: number;
  /** CSS pixels per degree. */
  readonly scale: number;
}

export interface FlatSize {
  readonly width: number;
  readonly height: number;
}

export interface FlatPoint {
  x: number;
  y: number;
}

/** Longitude in [−180, 180). */
export function wrapLon(lon: number): number {
  return lon - 360 * Math.floor((lon + 180) / 360);
}

/** The smallest scale: the frame filled, the world shown once. */
export function minFlatScale(size: FlatSize): number {
  return Math.max(size.width / 360, size.height / 180, 1e-6);
}

/** The view kept on the map: scale in range, no edge past a pole, longitude wrapped. */
export function clampFlat(view: FlatView, size: FlatSize, maxScale: number): FlatView {
  const least = minFlatScale(size);
  const scale = Math.min(Math.max(maxScale, least), Math.max(least, view.scale));
  const halfLat = size.height / 2 / scale;
  return {
    scale,
    lat: Math.min(90 - halfLat, Math.max(-90 + halfLat, view.lat)),
    lon: wrapLon(view.lon),
  };
}

/** Where (lat, lon) is drawn, into `out`. Longitude takes the copy nearest the centre. */
export function flatProject(
  view: FlatView,
  size: FlatSize,
  lat: number,
  lon: number,
  out: FlatPoint,
): FlatPoint {
  out.x = size.width / 2 + wrapLon(lon - view.lon) * view.scale;
  out.y = size.height / 2 - (lat - view.lat) * view.scale;
  return out;
}

export function flatUnproject(view: FlatView, size: FlatSize, x: number, y: number): LatLon {
  return {
    lat: Math.min(90, Math.max(-90, view.lat - (y - size.height / 2) / view.scale)),
    lon: wrapLon(view.lon + (x - size.width / 2) / view.scale),
  };
}

/** Zooms by `factor` about `point`, which stays over the same place where the edges allow. */
export function flatZoomAt(
  view: FlatView,
  size: FlatSize,
  factor: number,
  point: { readonly x: number; readonly y: number },
  maxScale: number,
): FlatView {
  const anchor = flatUnproject(view, size, point.x, point.y);
  const scale = clampFlat({ ...view, scale: view.scale * factor }, size, maxScale).scale;
  // Solve the projection for the centre that puts `anchor` back at `point`.
  return clampFlat(
    {
      scale,
      lon: anchor.lon - (point.x - size.width / 2) / scale,
      lat: anchor.lat + (point.y - size.height / 2) / scale,
    },
    size,
    maxScale,
  );
}

/** Moves the map with a drag of (dx, dy) pixels. */
export function flatPanBy(
  view: FlatView,
  size: FlatSize,
  dx: number,
  dy: number,
  maxScale: number,
): FlatView {
  return clampFlat(
    { scale: view.scale, lon: view.lon - dx / view.scale, lat: view.lat + dy / view.scale },
    size,
    maxScale,
  );
}

/** One drawImage: a rectangle of the texture (texels) into one of the frame (pixels). */
export interface TextureSpan {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dw: number;
}

/**
 * The parts of an equirectangular texture (`texture` texels, the
 * antimeridian at both edges) the view shows, left to right: one, or two
 * where the frame crosses the antimeridian. Each spans the frame's height.
 */
export function textureSpans(view: FlatView, size: FlatSize, texture: FlatSize): TextureSpan[] {
  const spanLon = size.width / view.scale;
  const left = view.lon - spanLon / 2;
  const top = view.lat + size.height / 2 / view.scale;
  const sy = ((90 - top) / 180) * texture.height;
  const sh = (size.height / view.scale / 180) * texture.height;
  const spans: TextureSpan[] = [];
  let lon = left;
  while (lon < left + spanLon - 1e-9) {
    const start = wrapLon(lon);
    const end = Math.min(left + spanLon, lon + (180 - start));
    const degrees = end - lon;
    spans.push({
      sx: ((start + 180) / 360) * texture.width,
      sy,
      sw: (degrees / 360) * texture.width,
      sh,
      dx: (lon - left) * view.scale,
      dw: degrees * view.scale,
    });
    lon = end;
  }
  return spans;
}
