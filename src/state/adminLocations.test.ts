import { describe, expect, it, vi } from 'vitest';

import type { AccountRemote } from '@/core';
import type { AdminConsoleRemote, LocationItem } from '@/core/admin';
import type { City, Gazetteer } from '@/core/data/places';
import type { AdminRemote } from '@/core/moderationQueue';

import {
  countryCodeValid,
  createLocationsController,
  createLocationsStore,
} from './adminLocations';
import type { AdminSession } from './adminSession';

function item(storyId: string, reports: number): LocationItem {
  return {
    storyId,
    seq: 7,
    title: `Story ${storyId}`,
    placeName: 'Somewhere',
    countryCode: 'PE',
    placeSource: 'gdelt',
    lat: 12.97,
    lon: -77.59,
    publishedAtMs: 0,
    reports,
    lastReportedAtMs: 0,
  };
}

const BENGALURU: City = {
  id: 1,
  name: 'Bengaluru',
  ascii: '',
  countryCode: 'IN',
  countryName: 'India',
  lat: 12.97,
  lon: 77.59,
  population: 8_400_000,
};

const PLACES: Gazetteer = {
  countries: [],
  cities: [BENGALURU],
  country: () => null,
  city: () => null,
};

function setup() {
  const remote = {
    storyQueue: vi.fn(),
    counters: vi.fn(),
    suggest: vi.fn(),
    openDiscussion: vi.fn(),
    locationQueue: vi.fn(async (_limit: number, seq?: number) =>
      seq === undefined ? [item('s1', 5), item('s2', 3)] : seq === 7 ? [item('s9', 0)] : [],
    ),
    fixLocation: vi.fn(async () => 5),
  } satisfies AdminConsoleRemote;
  const session: AdminSession = {
    account: {} as AccountRemote,
    admin: {} as AdminRemote,
    console: remote,
    signedIn: async () => true,
  };
  const store = createLocationsStore();
  const controller = createLocationsController({
    store,
    connect: async () => session,
    loadPlaces: async () => PLACES,
  });
  return { store, controller, remote };
}

describe('the location tool', () => {
  it('lists reported stories and loads the gazetteer', async () => {
    const { store, controller } = setup();
    await controller.load();
    await vi.waitFor(() => expect(store.getState().places).toBe(PLACES));
    expect(store.getState().items.map((i) => i.storyId)).toEqual(['s1', 's2']);
  });

  it('names a moved pin after the nearest city, until the admin types a name', async () => {
    const { store, controller } = setup();
    await controller.load();
    await vi.waitFor(() => expect(store.getState().places).toBe(PLACES));
    controller.select(item('s1', 5));
    controller.movePin({ lat: 12.95, lon: 77.6 });
    expect(store.getState()).toMatchObject({ placeName: 'Bengaluru', countryCode: 'IN' });
    controller.movePin({ lat: -30, lon: -100 });
    expect(store.getState()).toMatchObject({ placeName: '', countryCode: '' });
    controller.editPlace('placeName', 'Mid-ocean');
    controller.movePin({ lat: 12.95, lon: 77.6 });
    expect(store.getState().placeName).toBe('Mid-ocean');
  });

  it('moves the pin, answers the reports and takes the story off the list', async () => {
    const { store, controller, remote } = setup();
    await controller.load();
    controller.select(item('s1', 5));
    controller.placeAt({ lat: 12.97, lon: 77.59, name: 'Bengaluru', countryCode: 'IN' });
    controller.editPlace('placeName', ' Bengaluru ');
    expect(await controller.save()).toBe(true);
    expect(remote.fixLocation).toHaveBeenCalledWith('s1', {
      lat: 12.97,
      lon: 77.59,
      placeName: 'Bengaluru',
      countryCode: 'IN',
    });
    expect(store.getState()).toMatchObject({
      selected: null,
      message: { kind: 'moved', title: 'Story s1', reports: 5 },
    });
    expect(store.getState().items.map((i) => i.storyId)).toEqual(['s2']);
  });

  it('finds a story by its permalink, and says when it cannot', async () => {
    const { store, controller } = setup();
    await controller.lookup('https://agora.example/?story=7&cam=1,2,3');
    expect(store.getState().selected?.storyId).toBe('s9');
    await controller.lookup('https://agora.example/?story=8');
    expect(store.getState().message).toEqual({ kind: 'not-found' });
    await controller.lookup('London');
    expect(store.getState().message).toEqual({ kind: 'not-found' });
  });

  it('keeps the country to two capital letters, or none', async () => {
    const { store, controller, remote } = setup();
    controller.select(item('s1', 5));
    controller.editPlace('countryCode', 'ind');
    expect(store.getState().countryCode).toBe('IN');
    controller.editPlace('countryCode', 'i');
    expect(countryCodeValid(store.getState().countryCode)).toBe(false);
    expect(await controller.save()).toBe(false);
    expect(remote.fixLocation).not.toHaveBeenCalled();
    expect(countryCodeValid('')).toBe(true);
  });
});
