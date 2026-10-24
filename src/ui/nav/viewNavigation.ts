import { rowOfStory, vec3ToLatLon, type NodeBuffer } from '@/core';
import { altitudeToShowKm, type CameraPose } from '@/globe';
import { storyStore, timeStore } from '@/state';

/**
 * Taking the reader somewhere from outside the view: a search result, a
 * feed row, a saved story. The same moves a tap makes, from a list.
 */

/**
 * What the globe's controls and the flat map (Prompt 5.1) both do: go to a
 * place at an altitude, and say where they are. The flat map reads altitude
 * as the ground scale the globe would show from that height, so framing,
 * shared links and the cluster level agree across the two. Under reduced
 * motion flyTo lands at once.
 */
export interface ViewCamera {
  flyTo(lat: number, lon: number, altitudeKm: number): Promise<unknown>;
  getState(): CameraPose;
}

export interface ViewTarget {
  /** The visible view's camera; null before it exists, and in the list. */
  readonly camera: ViewCamera | null;
  /** The view's size in CSS pixels. */
  viewport(): { readonly width: number; readonly height: number };
}

/** A city is framed as a region this wide around it: its suburbs and neighbours. */
const CITY_FRAME_DEG = 2;

function aspect(target: ViewTarget): number {
  const { width, height } = target.viewport();
  return width / Math.max(1, height);
}

/** Flies to a place: a country framed whole, a city with its region. */
export function flyToPlace(
  target: ViewTarget,
  place: { readonly lat: number; readonly lon: number; readonly radiusDeg: number },
): void {
  if (!target.camera) return;
  const reach = place.radiusDeg > 0 ? place.radiusDeg : CITY_FRAME_DEG;
  void target.camera.flyTo(place.lat, place.lon, altitudeToShowKm(reach, aspect(target)));
}

/**
 * Opens story `id` and flies to it, framed with its region like a city
 * (never backing out): the petal level, where a stack fans out, is 75 km up
 * and shows nothing around it. A story still in a cluster there rings its
 * orb. One published after the displayed instant brings the time back to
 * live, or its pin would not be drawn (nor listed). A story the payload no
 * longer has (a save older than the window) opens without a flight.
 */
export function openStory(target: ViewTarget, nodes: NodeBuffer | null, id: number): void {
  const row = nodes ? rowOfStory(nodes, id) : -1;
  if (nodes && row >= 0) {
    const publishedMs = (nodes.epochSec + (nodes.publishedSec[row] ?? 0)) * 1000;
    if (publishedMs > timeStore.getState().timeMs) timeStore.getState().goLive();
    const { camera } = target;
    if (camera) {
      const p = nodes.positions;
      const at = vec3ToLatLon({
        x: p[row * 3] ?? 0,
        y: p[row * 3 + 1] ?? 0,
        z: p[row * 3 + 2] ?? 0,
      });
      const framed = altitudeToShowKm(CITY_FRAME_DEG, aspect(target));
      void camera.flyTo(at.lat, at.lon, Math.min(framed, camera.getState().altitudeKm));
    }
  }
  storyStore.getState().open(id);
}
