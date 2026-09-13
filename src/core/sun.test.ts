import { describe, expect, it } from 'vitest';

import { latLonToVec3, normalizeLon, type LatLon } from './geo';
import { equationOfTimeMinutes, julianDay, subsolarPoint, sunDirection } from './sun';

const DEG = Math.PI / 180;
const MINUTE_MS = 60_000;

/** sin(solar elevation) at a place: the same ndl the fragment shader computes. */
function sunElevationSine(place: LatLon, ms: number): number {
  const n = latLonToVec3(place, 1);
  const s = sunDirection(new Date(ms));
  return n.x * s.x + n.y * s.y + n.z * s.z;
}

/** Instant after `fromIso` at which the sun rises through `elevationDeg`, to ~1s. */
function riseThrough(place: LatLon, fromIso: string, elevationDeg: number): number {
  const threshold = Math.sin(elevationDeg * DEG);
  const start = Date.parse(fromIso);
  let previous = sunElevationSine(place, start);
  for (let t = start + MINUTE_MS; t < start + 36 * 3_600_000; t += MINUTE_MS) {
    const current = sunElevationSine(place, t);
    if (previous < threshold && current >= threshold) {
      // Bracketed within one minute; bisect so the scan step adds no error.
      let lo = t - MINUTE_MS;
      let hi = t;
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        if (sunElevationSine(place, mid) < threshold) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    previous = current;
  }
  throw new Error('no sunrise found');
}

function minutesApart(a: number, b: number): number {
  return Math.abs(a - b) / MINUTE_MS;
}

describe('julianDay', () => {
  it('anchors the Unix epoch and J2000', () => {
    expect(julianDay(new Date('1970-01-01T00:00:00Z'))).toBe(2_440_587.5);
    expect(julianDay(new Date('2000-01-01T12:00:00Z'))).toBe(2_451_545);
  });
});

describe('subsolarPoint latitude', () => {
  // Instants from the USNO/timeanddate season tables, to the minute.
  const equinoxes = [
    '2024-03-20T03:06Z',
    '2024-09-22T12:44Z',
    '2025-03-20T09:01Z',
    '2025-09-22T18:19Z',
    '2026-03-20T14:46Z',
    '2026-09-23T00:05Z',
  ];
  const juneSolstices = ['2024-06-20T20:51Z', '2025-06-21T02:42Z', '2026-06-21T08:24Z'];
  const decemberSolstices = ['2024-12-21T09:20Z', '2025-12-21T15:03Z', '2026-12-21T20:50Z'];

  it.each(equinoxes)('is ~0 at the equinox %s', (iso) => {
    expect(Math.abs(subsolarPoint(new Date(iso)).lat)).toBeLessThan(0.05);
  });

  it.each(juneSolstices)('is ~+23.44 at the June solstice %s', (iso) => {
    expect(subsolarPoint(new Date(iso)).lat).toBeCloseTo(23.44, 1);
  });

  it.each(decemberSolstices)('is ~-23.44 at the December solstice %s', (iso) => {
    expect(subsolarPoint(new Date(iso)).lat).toBeCloseTo(-23.44, 1);
  });
});

describe('equationOfTimeMinutes', () => {
  it('matches the yearly extremes', () => {
    expect(equationOfTimeMinutes(new Date('2026-02-11T12:00Z'))).toBeCloseTo(-14.2, 0);
    expect(equationOfTimeMinutes(new Date('2026-11-03T12:00Z'))).toBeCloseTo(16.4, 0);
  });

  it('crosses zero in mid April, mid June, early September and late December', () => {
    for (const iso of ['2026-04-15T12:00Z', '2026-06-13T12:00Z', '2026-09-01T12:00Z']) {
      expect(Math.abs(equationOfTimeMinutes(new Date(iso)))).toBeLessThan(0.6);
    }
    expect(Math.abs(equationOfTimeMinutes(new Date('2026-12-25T12:00Z')))).toBeLessThan(0.6);
  });
});

describe('subsolarPoint longitude', () => {
  it('agrees with the independent sidereal-time derivation (lon = RA - GMST)', () => {
    // Different route to the same answer: through Greenwich sidereal time
    // instead of the equation of time. Catches a sign flip in either.
    for (let day = 0; day < 365; day += 7) {
      const date = new Date(Date.UTC(2026, 0, 1 + day, (day * 7) % 24, 17));
      const n = julianDay(date) - 2_451_545;
      const L = (280.46 + 0.9856474 * n) % 360;
      const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
      const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
      const epsilon = (23.439 - 0.0000004 * n) * DEG;
      const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) / DEG;
      const gmst = 280.46061837 + 360.98564736629 * n;

      const expected = normalizeLon(ra - gmst);
      const actual = subsolarPoint(date).lon;
      expect(Math.abs(normalizeLon(actual - expected))).toBeLessThan(0.01);
    }
  });

  it('sits near Greenwich at 12:00 UTC, offset by the equation of time', () => {
    const date = new Date('2026-02-11T12:00Z');
    // Sundials lag 14.2 minutes, so the sun is still 3.55° east of Greenwich.
    expect(subsolarPoint(date).lon).toBeCloseTo(3.55, 1);
  });

  it('moves west at 15° per hour and stays in [-180, 180)', () => {
    const start = Date.parse('2026-09-13T00:00Z');
    for (let hour = 0; hour < 48; hour += 1) {
      const a = subsolarPoint(new Date(start + hour * 3_600_000)).lon;
      const b = subsolarPoint(new Date(start + (hour + 1) * 3_600_000)).lon;
      expect(a).toBeGreaterThanOrEqual(-180);
      expect(a).toBeLessThan(180);
      expect(normalizeLon(b - a)).toBeCloseTo(-15, 1);
    }
  });
});

describe('sunDirection', () => {
  it('is the unit vector toward the subsolar point', () => {
    const date = new Date('2026-06-21T08:24Z');
    const d = sunDirection(date);
    const p = latLonToVec3(subsolarPoint(date), 1);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
    expect(d).toEqual(p);
  });
});

describe('sunrise over India', () => {
  // Reference times from api.sunrise-sunset.org. Its sunrise is the sun's centre
  // at -0.833° (refraction plus semi-diameter), so the test solves for that
  // elevation rather than for the terminator itself (ndl = 0), which is ~5
  // minutes later.
  //
  // Solar noon is the sharp check: it depends only on longitude and the equation
  // of time, and lands within seconds. Sunrise carries a symmetric ~1 minute
  // difference from the almanac's horizon model (its sunset is early by the same
  // amount, so it is day length, not a clock offset), hence the looser bound.
  const cases = [
    {
      name: 'New Delhi, 2026-09-13',
      place: { lat: 28.6139, lon: 77.209 },
      from: '2026-09-12T12:00Z',
      sunrise: '2026-09-13T00:33:55Z',
      solarNoon: '2026-09-13T06:47:09Z',
    },
    {
      name: 'Kolkata, June solstice (rises the previous UTC day)',
      place: { lat: 22.5726, lon: 88.3639 },
      from: '2026-06-20T12:00Z',
      sunrise: '2026-06-20T23:21:31Z',
      solarNoon: '2026-06-21T06:08:19Z',
    },
    {
      name: 'Mumbai, December solstice',
      place: { lat: 19.076, lon: 72.8777 },
      from: '2026-12-20T12:00Z',
      sunrise: '2026-12-21T01:35:47Z',
      solarNoon: '2026-12-21T07:06:27Z',
    },
  ];

  it.each(cases)('$name: solar noon within 30 seconds', ({ place, solarNoon }) => {
    const reference = Date.parse(solarNoon);
    let peak = reference - 10 * MINUTE_MS;
    for (let t = peak; t <= reference + 10 * MINUTE_MS; t += 1000) {
      if (sunElevationSine(place, t) > sunElevationSine(place, peak)) peak = t;
    }
    expect(minutesApart(peak, reference)).toBeLessThan(0.5);
  });

  it.each(cases)('$name: sunrise within 2 minutes', ({ place, from, sunrise }) => {
    expect(minutesApart(riseThrough(place, from, -0.833), Date.parse(sunrise))).toBeLessThan(2);
  });

  it('puts the New Delhi terminator crossing between 00:35 and 00:45 UTC on 2026-09-13', () => {
    const crossing = riseThrough({ lat: 28.6139, lon: 77.209 }, '2026-09-12T12:00Z', 0);
    expect(crossing).toBeGreaterThanOrEqual(Date.parse('2026-09-13T00:35Z'));
    expect(crossing).toBeLessThanOrEqual(Date.parse('2026-09-13T00:45Z'));
  });
});
