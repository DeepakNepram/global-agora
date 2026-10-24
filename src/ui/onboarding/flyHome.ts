import type { LatLon } from '@/core';
import { fitAltitudeKm } from '@/globe';

import type { ViewTarget } from '../nav/viewNavigation';

/** The resting view: the whole globe, centred on `home`. */
export function flyHome(target: ViewTarget, home: LatLon): void {
  if (!target.camera) return;
  const { width, height } = target.viewport();
  void target.camera.flyTo(home.lat, home.lon, fitAltitudeKm(width / Math.max(1, height)));
}
