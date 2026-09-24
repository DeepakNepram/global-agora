import { describe, expect, it } from 'vitest';

import { PETAL_LEVEL } from '@/core';

import { MIN_ALTITUDE_KM, fitAltitudeKm, maxAltitudeKm } from '../camera/cameraMath';
import {
  LEVEL_HYSTERESIS,
  altitudeKmAt,
  altitudeKmForZoom,
  clusterZoomFor,
  nextClusterLevel,
} from './clusterZoom';

describe('clusterZoomFor', () => {
  it('puts the world view near zoom 2 and a city view near 7', () => {
    expect(clusterZoomFor(fitAltitudeKm(16 / 9), 900)).toBeCloseTo(2.05, 1);
    expect(clusterZoomFor(600, 900)).toBeCloseTo(7.0, 1);
  });

  it('reaches the petal level from the closest altitude on any screen', () => {
    // A landscape phone is the shortest viewport.
    expect(clusterZoomFor(MIN_ALTITUDE_KM, 360)).toBeGreaterThan(PETAL_LEVEL + LEVEL_HYSTERESIS);
  });

  it('gains a level for every halving of altitude or doubling of screen height', () => {
    const base = clusterZoomFor(400, 800);
    expect(clusterZoomFor(200, 800) - base).toBeCloseTo(1, 9);
    expect(clusterZoomFor(400, 1600) - base).toBeCloseTo(1, 9);
  });

  it('is inverted by altitudeKmForZoom', () => {
    for (const zoom of [1.5, 4.2, 8.5, 9.5]) {
      expect(clusterZoomFor(altitudeKmForZoom(zoom, 750), 750)).toBeCloseTo(zoom, 9);
    }
  });

  it('stays finite at the far limit', () => {
    expect(Number.isFinite(clusterZoomFor(maxAltitudeKm(0.5), 640))).toBe(true);
  });
});

describe('nextClusterLevel', () => {
  it('starts at floor(zoom), clamped to the levels that exist', () => {
    expect(nextClusterLevel(null, 3.7)).toBe(3);
    expect(nextClusterLevel(null, -1)).toBe(0);
    expect(nextClusterLevel(null, 14)).toBe(PETAL_LEVEL);
  });

  it('holds a level until the zoom has clearly left it', () => {
    expect(nextClusterLevel(3, 4.05)).toBe(3);
    expect(nextClusterLevel(3, 4 + LEVEL_HYSTERESIS)).toBe(4);
    expect(nextClusterLevel(3, 2.95)).toBe(3);
    expect(nextClusterLevel(3, 2.85)).toBe(2);
    expect(nextClusterLevel(3, 6.2)).toBe(6);
  });

  it('never leaves the deepest level by zooming further in, nor level 0 by zooming out', () => {
    expect(nextClusterLevel(PETAL_LEVEL, 30)).toBe(PETAL_LEVEL);
    expect(nextClusterLevel(0, -5)).toBe(0);
    expect(nextClusterLevel(2, Number.NaN)).toBe(2);
  });
});

describe('altitudeKmAt', () => {
  it('is the height above the surface of a camera at that distance', () => {
    expect(altitudeKmAt(1)).toBe(0);
    expect(altitudeKmAt(2)).toBeCloseTo(6371, 0);
  });
});
