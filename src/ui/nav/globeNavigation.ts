import { rowOfStory, vec3ToLatLon, type NodeBuffer } from '@/core';
import { altitudeToShowKm, type OrbitGlobeControls } from '@/globe';
import { storyStore, timeStore } from '@/state';

/**
 * Taking the reader somewhere from outside the globe: a search result, a
 * feed row, a saved story. The same moves a tap makes, from a list.
 */

export interface GlobeTarget {
  readonly controls: OrbitGlobeControls | null;
  /** The canvas's size in CSS pixels. */
  viewport(): { readonly width: number; readonly height: number };
}

/** A city is framed as a region this wide around it: its suburbs and neighbours. */
const CITY_FRAME_DEG = 2;

function aspect(target: GlobeTarget): number {
  const { width, height } = target.viewport();
  return width / Math.max(1, height);
}

/** Flies to a place: a country framed whole, a city with its region. */
export function flyToPlace(
  target: GlobeTarget,
  place: { readonly lat: number; readonly lon: number; readonly radiusDeg: number },
): void {
  if (!target.controls) return;
  const reach = place.radiusDeg > 0 ? place.radiusDeg : CITY_FRAME_DEG;
  void target.controls.flyTo(place.lat, place.lon, altitudeToShowKm(reach, aspect(target)));
}

/**
 * Opens story `id` and flies to it, framed with its region like a city
 * (never backing out): the petal level, where a stack fans out, is 75 km up
 * and shows nothing around it. A story still in a cluster there rings its
 * orb. One published after the displayed instant brings the time back to
 * live, or its pin would not be drawn. A story the globe no longer has (a
 * save older than the window) opens without a flight.
 */
export function openStoryOnGlobe(target: GlobeTarget, nodes: NodeBuffer | null, id: number): void {
  const row = nodes ? rowOfStory(nodes, id) : -1;
  if (nodes && row >= 0) {
    const publishedMs = (nodes.epochSec + (nodes.publishedSec[row] ?? 0)) * 1000;
    if (publishedMs > timeStore.getState().timeMs) timeStore.getState().goLive();
    const { controls } = target;
    if (controls) {
      const p = nodes.positions;
      const at = vec3ToLatLon({
        x: p[row * 3] ?? 0,
        y: p[row * 3 + 1] ?? 0,
        z: p[row * 3 + 2] ?? 0,
      });
      const framed = altitudeToShowKm(CITY_FRAME_DEG, aspect(target));
      void controls.flyTo(at.lat, at.lon, Math.min(framed, controls.getState().altitudeKm));
    }
  }
  storyStore.getState().open(id);
}
