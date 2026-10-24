import {
  clampFlat,
  EARTH_RADIUS_KM,
  flatPanBy,
  flatZoomAt,
  minFlatScale,
  type FlatSize,
  type FlatView,
  type LatLon,
} from '@/core';
import { CAMERA_FOV_DEG, MIN_ALTITUDE_KM, radiansPerScreenHeight, type CameraPose } from '@/globe';

import type { ViewCamera } from '../nav/viewNavigation';

const DEG = Math.PI / 180;

/**
 * Globe altitude and map scale, matched by the ground they show: from
 * altitude h the globe shows the ground at the view's centre at
 *   P = viewport height / radiansPerScreenHeight(h)   pixels per radian
 * and the map draws P · π / 180 pixels per degree. So a search frames a
 * country the same on both, a shared link opens at the same place and size,
 * and the cluster level (clusterZoomFor, from altitude) agrees.
 */
export function scaleForAltitude(altitudeKm: number, height: number): number {
  return (Math.max(1, height) / radiansPerScreenHeight(Math.max(altitudeKm, 1e-3))) * DEG;
}

/** The inverse: radiansPerScreenHeight is linear in altitude (panBase · h / R). */
export function altitudeForScale(scale: number, height: number): number {
  const radians = Math.max(1, height) / (scale / DEG);
  return (radians / radiansPerScreenHeight(EARTH_RADIUS_KM, CAMERA_FOV_DEG)) * EARTH_RADIUS_KM;
}

/** Arrow keys move the map by this share of its smaller side. */
const NUDGE_FRACTION = 0.1;
/** + and − zoom by this factor. */
const ZOOM_STEP = 2;

export interface FlatControls extends ViewCamera {
  view(): FlatView;
  size(): FlatSize;
  /** The frame's CSS size; the first one places the opening view. */
  setSize(size: FlatSize): void;
  panBy(dx: number, dy: number): void;
  zoomAt(factor: number, point: { readonly x: number; readonly y: number }): void;
  zoomStep(direction: 'in' | 'out'): void;
  /** Arrow keys: +1 east / north, −1 west / south. */
  nudge(east: number, north: number): void;
  /** Called after every change of view. */
  onChange(listener: () => void): () => void;
}

/**
 * The flat map's camera (Prompt 5.1). Under reduced motion nothing animates:
 * flyTo lands at once and a drag carries no inertia. It answers the same
 * questions the globe's controls do (ViewCamera), in altitude.
 */
export function createFlatControls(
  initial: CameraPose | null,
  restingCenter: LatLon | null,
): FlatControls {
  let size: FlatSize = { width: 0, height: 0 };
  let view: FlatView = { lat: 0, lon: 0, scale: 1 };
  // A pose asked for before the frame was measured, applied on the first size.
  let pending: CameraPose | null = initial ?? {
    lat: 0,
    lon: restingCenter?.lon ?? 0,
    altitudeKm: Infinity,
  };
  const listeners = new Set<() => void>();
  const maxScale = (): number => scaleForAltitude(MIN_ALTITUDE_KM, size.height);

  const change = (next: FlatView): void => {
    view = clampFlat(next, size, maxScale());
    for (const listener of listeners) listener();
  };

  const place = (pose: CameraPose): void => {
    const scale = Number.isFinite(pose.altitudeKm)
      ? scaleForAltitude(pose.altitudeKm, size.height)
      : minFlatScale(size);
    change({ lat: pose.lat, lon: pose.lon, scale });
  };

  return {
    view: () => view,
    size: () => size,
    setSize(next) {
      if (next.width <= 0 || next.height <= 0) return;
      const first = size.width === 0;
      size = next;
      if (pending && first) {
        const pose = pending;
        pending = null;
        place(pose);
      } else {
        change(view);
      }
    },
    flyTo(lat, lon, altitudeKm) {
      if (size.width === 0) pending = { lat, lon, altitudeKm };
      else place({ lat, lon, altitudeKm });
      return Promise.resolve();
    },
    getState() {
      if (size.width === 0 && pending) return pending;
      return {
        lat: view.lat,
        lon: view.lon,
        altitudeKm: altitudeForScale(view.scale, size.height),
      };
    },
    panBy(dx, dy) {
      change(flatPanBy(view, size, dx, dy, maxScale()));
    },
    zoomAt(factor, point) {
      change(flatZoomAt(view, size, factor, point, maxScale()));
    },
    zoomStep(direction) {
      const centre = { x: size.width / 2, y: size.height / 2 };
      change(
        flatZoomAt(view, size, direction === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP, centre, maxScale()),
      );
    },
    nudge(east, north) {
      const step = Math.min(size.width, size.height) * NUDGE_FRACTION;
      change(flatPanBy(view, size, -east * step, north * step, maxScale()));
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
