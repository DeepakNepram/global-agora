import type { LatLon } from '@/core';
import { fitAltitudeKm } from '@/globe';

import type { GlobeTarget } from '../nav/globeNavigation';

/** The resting view: the whole globe, centred on `home`. */
export function flyHome(target: GlobeTarget, home: LatLon): void {
  if (!target.controls) return;
  const { width, height } = target.viewport();
  void target.controls.flyTo(home.lat, home.lon, fitAltitudeKm(width / Math.max(1, height)));
}
