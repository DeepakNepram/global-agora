import { describe, expect, it } from 'vitest';

import { clusterZoomFor, MIN_ALTITUDE_KM, radiansPerScreenHeight } from '@/globe';

import { altitudeForScale, createFlatControls, scaleForAltitude } from './flatCamera';

const size = { width: 1200, height: 600 };

describe('flat camera', () => {
  it('matches the globe: the ground at the centre is drawn at the same pixels per degree', () => {
    const scale = scaleForAltitude(2000, size.height);
    const globePxPerRadian = size.height / radiansPerScreenHeight(2000);
    expect(scale).toBeCloseTo((globePxPerRadian * Math.PI) / 180, 9);
    expect(altitudeForScale(scale, size.height)).toBeCloseTo(2000, 6);
  });

  it('gives the cluster level the globe would at the same altitude', () => {
    const controls = createFlatControls({ lat: 10, lon: 20, altitudeKm: 900 }, null);
    controls.setSize(size);
    const { altitudeKm } = controls.getState();
    expect(clusterZoomFor(altitudeKm, size.height)).toBeCloseTo(
      clusterZoomFor(900, size.height),
      9,
    );
  });

  it('opens on a shared view once measured, else the world centred on home', () => {
    const shared = createFlatControls({ lat: 48.8, lon: 2.3, altitudeKm: 600 }, null);
    expect(shared.getState()).toMatchObject({ lat: 48.8, lon: 2.3 });
    shared.setSize(size);
    expect(shared.view().lat).toBeCloseTo(48.8, 9);
    const home = createFlatControls(null, { lat: 28.6, lon: 77.2 });
    home.setSize(size);
    expect(home.view()).toMatchObject({ lat: 0, lon: 77.2, scale: 600 / 180 });
  });

  it('lands a flight at once and tells its listeners', () => {
    const controls = createFlatControls(null, null);
    controls.setSize(size);
    let changes = 0;
    controls.onChange(() => changes++);
    void controls.flyTo(-33.9, 151.2, 1500);
    expect(changes).toBe(1);
    expect(controls.view().lon).toBeCloseTo(151.2, 9);
    expect(controls.getState().altitudeKm).toBeCloseTo(1500, 6);
  });

  it('never zooms past the globe’s closest approach', () => {
    const controls = createFlatControls(null, null);
    controls.setSize(size);
    for (let i = 0; i < 40; i++) controls.zoomStep('in');
    expect(controls.getState().altitudeKm).toBeCloseTo(MIN_ALTITUDE_KM, 6);
  });

  it('nudges by a tenth of the frame, east and north', () => {
    const controls = createFlatControls({ lat: 0, lon: 0, altitudeKm: 3000 }, null);
    controls.setSize(size);
    const before = controls.view();
    controls.nudge(1, 1);
    const after = controls.view();
    expect((after.lon - before.lon) * before.scale).toBeCloseTo(60, 6);
    expect((after.lat - before.lat) * before.scale).toBeCloseTo(60, 6);
  });
});
