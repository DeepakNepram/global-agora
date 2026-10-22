import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { nearestCity, type LatLon } from '@/core';
// Directly, not through the barrels: only the /admin chunk carries the console.
import { ADMIN_PAGE, AdminError, storySeqFrom, type LocationItem } from '@/core/admin';
import type { Gazetteer } from '@/core/data/places';

import type { AdminSession } from './adminSession';

/**
 * The admin console's location correction tool (Prompt 4.6): stories readers
 * reported as in the wrong place, or one found by its permalink, and a pin
 * the admin moves. The place's name follows the pin (the nearest city in
 * the gazetteer) until the admin types one.
 */

export type LocationMessage =
  | { readonly kind: 'moved'; readonly title: string; readonly reports: number }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed' };

export interface LocationsState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly items: readonly LocationItem[];
  readonly selected: LocationItem | null;
  /** Where the pin is now: the story's place until it is moved. */
  readonly pin: LatLon | null;
  readonly placeName: string;
  readonly countryCode: string;
  /** The admin typed the place: moving the pin no longer renames it. */
  readonly placeTyped: boolean;
  readonly saving: boolean;
  readonly message: LocationMessage | null;
  /** The gazetteer, for the nearest city and the place search; null until loaded. */
  readonly places: Gazetteer | null;
}

export type LocationsStore = StoreApi<LocationsState>;

export function createLocationsStore(): LocationsStore {
  return createStore<LocationsState>()(() => ({
    status: 'idle',
    items: [],
    selected: null,
    pin: null,
    placeName: '',
    countryCode: '',
    placeTyped: false,
    saving: false,
    message: null,
    places: null,
  }));
}

export const locationsStore: LocationsStore = createLocationsStore();

export function useLocationsStore<T>(selector: (state: LocationsState) => T): T {
  return useStore(locationsStore, selector);
}

/** A place chosen from the search: its point and its name. */
export interface ChosenPlace {
  readonly lat: number;
  readonly lon: number;
  readonly name: string;
  readonly countryCode: string;
}

export interface LocationsController {
  /** The reported stories, and the gazetteer behind them. */
  load(): Promise<void>;
  /** Finds one story by a pasted permalink or its number. */
  lookup(text: string): Promise<void>;
  select(item: LocationItem): void;
  movePin(at: LatLon): void;
  placeAt(place: ChosenPlace): void;
  editPlace(field: 'placeName' | 'countryCode', value: string): void;
  cancel(): void;
  /** Moves the story's pin; true when it moved. */
  save(): Promise<boolean>;
}

/** Two letters or nothing: what the database takes. */
export function countryCodeValid(code: string): boolean {
  return code === '' || /^[A-Z]{2}$/.test(code);
}

export function createLocationsController(options: {
  readonly store: LocationsStore;
  readonly connect: () => Promise<AdminSession>;
  readonly loadPlaces: () => Promise<Gazetteer>;
}): LocationsController {
  const { store, connect, loadPlaces } = options;
  const remote = async () => (await connect()).console;

  function namePin(at: LatLon): Pick<LocationsState, 'placeName' | 'countryCode'> | null {
    const { places, placeTyped } = store.getState();
    if (placeTyped || places === null) return null;
    const city = nearestCity(places, at);
    // No city near (the sea, the desert): no name, rather than a wrong one.
    return { placeName: city?.name ?? '', countryCode: city?.countryCode ?? '' };
  }

  function select(item: LocationItem): void {
    store.setState({
      selected: item,
      pin: { lat: item.lat, lon: item.lon },
      placeName: item.placeName ?? '',
      countryCode: item.countryCode ?? '',
      placeTyped: false,
      message: null,
    });
  }

  return {
    async load() {
      store.setState({ status: 'loading' });
      void loadPlaces()
        .then((places) => store.setState({ places }))
        .catch(() => {
          // Without the gazetteer the admin types the place; the map still works.
        });
      try {
        const items = await (await remote()).locationQueue(ADMIN_PAGE);
        store.setState({ status: 'ready', items });
      } catch {
        store.setState({ status: 'failed' });
      }
    },

    async lookup(text) {
      const seq = storySeqFrom(text);
      if (seq === null) {
        store.setState({ message: { kind: 'not-found' } });
        return;
      }
      try {
        const [item] = await (await remote()).locationQueue(1, seq);
        if (item === undefined) store.setState({ message: { kind: 'not-found' } });
        else select(item);
      } catch {
        store.setState({ message: { kind: 'failed' } });
      }
    },

    select,

    movePin(at) {
      if (store.getState().selected === null || store.getState().saving) return;
      store.setState({ pin: at, ...namePin(at) });
    },

    placeAt(place) {
      if (store.getState().selected === null || store.getState().saving) return;
      store.setState({
        pin: { lat: place.lat, lon: place.lon },
        placeName: place.name,
        countryCode: place.countryCode,
        placeTyped: false,
      });
    },

    editPlace(field, value) {
      const next = field === 'countryCode' ? value.toUpperCase().slice(0, 2) : value;
      store.setState({ [field]: next, placeTyped: true });
    },

    cancel() {
      if (!store.getState().saving) store.setState({ selected: null, pin: null });
    },

    async save() {
      const { selected, pin, placeName, countryCode, saving } = store.getState();
      if (selected === null || pin === null || saving || !countryCodeValid(countryCode)) {
        return false;
      }
      store.setState({ saving: true, message: null });
      try {
        const reports = await (
          await remote()
        ).fixLocation(selected.storyId, {
          lat: pin.lat,
          lon: pin.lon,
          placeName: placeName.trim() === '' ? null : placeName.trim(),
          countryCode: countryCode === '' ? null : countryCode,
        });
        store.setState({
          saving: false,
          selected: null,
          pin: null,
          items: store.getState().items.filter((item) => item.storyId !== selected.storyId),
          message: { kind: 'moved', title: selected.title, reports },
        });
        return true;
      } catch (error) {
        const missing = error instanceof AdminError && error.code === 'missing';
        store.setState({ saving: false, message: { kind: missing ? 'not-found' : 'failed' } });
        return false;
      }
    },
  };
}
