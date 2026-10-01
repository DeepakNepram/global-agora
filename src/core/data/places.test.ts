import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { cityLabel, nearestCity, surfaceKm } from '../places';
import { fetchPlaces, parsePlaces, PlacesError, PLACES_PATH } from './places';
import { samplePlacesJson } from './places.fixture';

describe('parsePlaces', () => {
  it('reads countries and cities back into degrees and whole ids', () => {
    const places = parsePlaces(samplePlacesJson());
    expect(places.countries).toHaveLength(3);
    expect(places.country('US')).toMatchObject({
      name: 'United States of America',
      aliases: ['United States', 'USA'],
      lat: 39.54,
      lon: -97.48,
      radiusDeg: 23.1,
    });
    expect(places.country('BR')?.aliases).toEqual([]);
    expect(places.city(1159151609)).toMatchObject({
      name: 'Tokyo',
      ascii: '',
      countryCode: 'JP',
      countryName: 'Japan',
      lat: 35.69,
      lon: 139.75,
    });
  });

  it('keeps a city without an ISO code under its country name', () => {
    const hargeisa = parsePlaces(samplePlacesJson()).city(1159151189);
    expect(hargeisa).toMatchObject({ countryCode: '', countryName: 'Somaliland' });
  });

  it('refuses a malformed file, naming the problem', () => {
    const bad = (change: (json: Record<string, unknown>) => void): unknown => {
      const json = samplePlacesJson();
      change(json);
      return json;
    };
    expect(() => parsePlaces(null)).toThrow(PlacesError);
    expect(() => parsePlaces({ ...samplePlacesJson(), v: 2 })).toThrow(/version 1/);
    expect(() =>
      parsePlaces(
        bad((json) => {
          (json['cities'] as Record<string, unknown>)['lat'] = [1, 2];
        }),
      ),
    ).toThrow(/lat has 2 entries/);
    expect(() =>
      parsePlaces(
        bad((json) => {
          (json['countries'] as Record<string, unknown>)['code'] = ['BRA', 'JP', 'US'];
        }),
      ),
    ).toThrow(/code\[0\]/);
  });

  it('reads the generated file', () => {
    const json: unknown = JSON.parse(
      readFileSync(new URL('../../../public/data/places.v1.json', import.meta.url), 'utf8'),
    );
    const places = parsePlaces(json);
    expect(places.cities.length).toBeGreaterThan(7000);
    expect(places.countries.length).toBeGreaterThan(200);
    expect(places.country('FR')?.radiusDeg).toBeLessThan(10);
    expect(places.cities.find((city) => city.name === 'Cayenne')?.countryName).toBe(
      'French Guiana',
    );
    expect(new Set(places.cities.map((city) => city.id)).size).toBe(places.cities.length);
  });
});

describe('fetchPlaces', () => {
  it('fetches from the app root and parses', async () => {
    const urls: string[] = [];
    const places = await fetchPlaces('/app/', {
      fetch: async (url) => {
        urls.push(url);
        return new Response(JSON.stringify(samplePlacesJson()));
      },
    });
    expect(urls).toEqual([`/app/${PLACES_PATH}`]);
    expect(places.cities).toHaveLength(4);
  });

  it('fails on an HTTP error', async () => {
    await expect(
      fetchPlaces('/', { fetch: async () => new Response('', { status: 404 }) }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe('cityLabel and nearestCity', () => {
  const places = parsePlaces(samplePlacesJson());

  it('labels a city with its country', () => {
    const label = (id: number): string => {
      const city = places.city(id);
      if (!city) throw new Error(`no city ${id}`);
      return cityLabel(city);
    };
    expect(label(1159151609)).toBe('Tokyo, Japan');
    expect(label(1159151189)).toBe('Hargeisa, Somaliland');
  });

  it('finds the nearest city within reach', () => {
    // Shinjuku: Tokyo's centre is 5 km away, Yokohama's 27 km.
    expect(nearestCity(places, { lat: 35.69, lon: 139.7 })?.name).toBe('Tokyo');
    expect(nearestCity(places, { lat: 35.47, lon: 139.62 })?.name).toBe('Yokohama');
    expect(nearestCity(places, { lat: 0, lon: 0 })).toBeNull();
    expect(nearestCity(places, { lat: 35.69, lon: 139.7 }, 1)).toBeNull();
  });

  it('measures along the surface', () => {
    expect(surfaceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.2, 1);
  });
});
