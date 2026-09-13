import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { angularDistance, latLonToVec3, vec3ToLatLon, type LatLon } from '@/core';

import {
  MAX_FLIGHT_MS,
  MIN_FLIGHT_MS,
  arcAltitudeKm,
  easeInOutCubic,
  flightDurationMs,
  peakAltitudeKm,
  planFlight,
} from './flight';

const LONDON = { lat: 51.5074, lon: -0.1278, altitudeKm: 600 };
const PARIS = { lat: 48.8566, lon: 2.3522, altitudeKm: 600 };
const SYDNEY = { lat: -33.8688, lon: 151.2093, altitudeKm: 600 };
const MAX_KM = 30_000;

function centreAt(flight: ReturnType<typeof planFlight>, t: number): LatLon {
  const centre = new Vector3();
  flight.sample(t * flight.durationMs, centre);
  return vec3ToLatLon(centre);
}

describe('easeInOutCubic', () => {
  it('runs 0 to 1, symmetric about the midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    for (let t = 0; t <= 1; t += 0.05) {
      expect(easeInOutCubic(t) + easeInOutCubic(1 - t)).toBeCloseTo(1, 12);
    }
  });

  it('is monotonic and clamped', () => {
    let previous = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      expect(easeInOutCubic(t)).toBeGreaterThanOrEqual(previous);
      previous = easeInOutCubic(t);
    }
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe('flight duration curve', () => {
  it('spans 800 ms at no distance to 3000 ms at the antipode', () => {
    expect(flightDurationMs(0)).toBe(MIN_FLIGHT_MS);
    expect(flightDurationMs(Math.PI)).toBe(MAX_FLIGHT_MS);
  });

  it('rises monotonically with angular distance', () => {
    let previous = 0;
    for (let angle = 0; angle <= Math.PI; angle += 0.05) {
      expect(flightDurationMs(angle)).toBeGreaterThan(previous);
      previous = flightDurationMs(angle);
    }
  });

  it('clamps out-of-range input', () => {
    expect(flightDurationMs(-1)).toBe(MIN_FLIGHT_MS);
    expect(flightDurationMs(10)).toBe(MAX_FLIGHT_MS);
    expect(flightDurationMs(Number.NaN)).toBe(MIN_FLIGHT_MS);
  });

  it('gives real routes sensible times', () => {
    expect(flightDurationMs(angularDistance(PARIS, LONDON))).toBeGreaterThan(1000);
    expect(flightDurationMs(angularDistance(PARIS, LONDON))).toBeLessThan(1150);
    expect(flightDurationMs(angularDistance(LONDON, SYDNEY))).toBeGreaterThan(2700);
    expect(flightDurationMs(angularDistance(LONDON, SYDNEY))).toBeLessThan(2950);
  });
});

describe('altitude arc', () => {
  it('peaks mid-flight on a long hop between equal altitudes', () => {
    const peak = peakAltitudeKm(angularDistance(LONDON, SYDNEY), 600, 600, MAX_KM);
    expect(peak).toBeGreaterThan(15_000);
    expect(arcAltitudeKm(0.5, 600, 600, peak)).toBeCloseTo(peak, 6);
    for (const e of [0.1, 0.3, 0.7, 0.9]) {
      expect(arcAltitudeKm(e, 600, 600, peak)).toBeLessThan(peak);
    }
  });

  it('does not rise on a short hop', () => {
    const angle = angularDistance(PARIS, LONDON);
    expect(peakAltitudeKm(angle, 600, 600, MAX_KM)).toBe(600);
    expect(arcAltitudeKm(0.5, 600, 600, 600)).toBeCloseTo(600, 9);
  });

  it('zooms monotonically, with no overshoot, when only altitude changes', () => {
    const peak = peakAltitudeKm(0, 50, 20_000, MAX_KM);
    let previous = 0;
    for (let e = 0; e <= 1; e += 0.02) {
      const h = arcAltitudeKm(e, 50, 20_000, peak);
      expect(h).toBeGreaterThanOrEqual(previous);
      expect(h).toBeLessThanOrEqual(20_000 + 1e-6);
      previous = h;
    }
  });

  it('never exceeds the altitude ceiling', () => {
    expect(peakAltitudeKm(Math.PI, 600, 600, 10_000)).toBe(10_000);
  });
});

describe('great-circle path', () => {
  it('starts and ends exactly on the two poses', () => {
    const flight = planFlight(LONDON, SYDNEY, MAX_KM);
    const end = new Vector3();
    expect(flight.sample(0, end)).toBeCloseTo(600, 9);
    expect(angularDistance(vec3ToLatLon(end), LONDON)).toBeLessThan(1e-9);
    expect(flight.sample(flight.durationMs, end)).toBeCloseTo(600, 9);
    expect(angularDistance(vec3ToLatLon(end), SYDNEY)).toBeLessThan(1e-9);
  });

  it('stays on the great circle and never doubles back', () => {
    const flight = planFlight(LONDON, SYDNEY, MAX_KM);
    const a = latLonToVec3(LONDON);
    const b = latLonToVec3(SYDNEY);
    const normal = new Vector3(a.x, a.y, a.z).cross(new Vector3(b.x, b.y, b.z)).normalize();
    let previous = -1;
    for (let t = 0; t <= 1; t += 0.02) {
      const centre = new Vector3();
      flight.sample(t * flight.durationMs, centre);
      expect(Math.abs(centre.dot(normal))).toBeLessThan(1e-9);
      const travelled = angularDistance(LONDON, vec3ToLatLon(centre));
      expect(travelled).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = travelled;
    }
  });

  it('climbs before it travels', () => {
    const flight = planFlight(LONDON, SYDNEY, MAX_KM);
    const t = 0.25;
    const progress = angularDistance(LONDON, centreAt(flight, t)) / flight.angleRad;
    expect(progress).toBeLessThan(easeInOutCubic(t) / 2);
  });

  it('eases lateral motion exactly when altitude is constant', () => {
    const flight = planFlight(PARIS, LONDON, MAX_KM);
    for (const t of [0.2, 0.5, 0.8]) {
      const progress = angularDistance(PARIS, centreAt(flight, t)) / flight.angleRad;
      expect(progress).toBeCloseTo(easeInOutCubic(t), 9);
    }
  });

  it('goes over the north pole between exact antipodes', () => {
    const flight = planFlight(
      { lat: 0, lon: 0, altitudeKm: 600 },
      { lat: 0, lon: 180, altitudeKm: 600 },
      MAX_KM,
    );
    expect(centreAt(flight, 0.5).lat).toBeCloseTo(90, 6);
  });

  it('honours an explicit duration', () => {
    expect(planFlight(LONDON, SYDNEY, MAX_KM, 1234).durationMs).toBe(1234);
  });
});
