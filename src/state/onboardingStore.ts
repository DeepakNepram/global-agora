import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { browserStorage, readJson, writeJson, type KeyValueStorage } from './persist';

/**
 * First-run onboarding (Prompt 3.4): after about a minute of use, or on the
 * first save, a three-step sheet asks for interests (followed categories),
 * a home city and an alerts opt-in. Skippable, and shown once.
 *
 * All of it stays on this device. The home city is where the reader lives,
 * so it never goes to the database (CLAUDE.md #5); it only decides where the
 * globe rests. The alerts answer is recorded and nothing more until alerts
 * exist, when the browser will be asked (the reader's call, Prompt 3.4).
 */

export interface HomeCity {
  /** Natural Earth's ne_id. */
  readonly id: number;
  readonly label: string;
  readonly lat: number;
  readonly lon: number;
}

export type OnboardingStatus = 'pending' | 'done' | 'skipped';

export interface OnboardingState {
  readonly status: OnboardingStatus;
  /** Seconds the page was visible, across visits, until it showed. */
  readonly usedSeconds: number;
  readonly homeCity: HomeCity | null;
  /** The alerts opt-in; null when never answered. */
  readonly alerts: boolean | null;
  /** The sheet is up. */
  readonly open: boolean;
  /** Counts visible use while pending. */
  addUse(seconds: number): void;
  /** Opens the sheet if it has never been finished. */
  show(): void;
  finish(status: 'done' | 'skipped'): void;
  setHomeCity(city: HomeCity | null): void;
  setAlerts(on: boolean): void;
}

export type OnboardingStore = StoreApi<OnboardingState>;

export const ONBOARDING_STORAGE_KEY = 'agora.onboarding.v1';

/** "After ~60 seconds of use" (Prompt 3.4). */
export const ONBOARDING_AFTER_SECONDS = 60;

/** Use is written to storage this often, not every second. */
const USE_WRITE_EVERY_SECONDS = 10;

interface Saved {
  readonly status: OnboardingStatus;
  readonly usedSeconds: number;
  readonly homeCity: HomeCity | null;
  readonly alerts: boolean | null;
}

function isHomeCity(value: unknown): value is HomeCity {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'number' &&
    typeof v['label'] === 'string' &&
    typeof v['lat'] === 'number' &&
    Math.abs(v['lat']) <= 90 &&
    typeof v['lon'] === 'number' &&
    Math.abs(v['lon']) <= 180
  );
}

function load(storage: KeyValueStorage | null): Saved {
  const raw = readJson(storage, ONBOARDING_STORAGE_KEY);
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const status = v['status'];
  const used = v['usedSeconds'];
  const alerts = v['alerts'];
  return {
    status: status === 'done' || status === 'skipped' ? status : 'pending',
    usedSeconds: typeof used === 'number' && used >= 0 ? used : 0,
    homeCity: isHomeCity(v['homeCity']) ? v['homeCity'] : null,
    alerts: typeof alerts === 'boolean' ? alerts : null,
  };
}

export function createOnboardingStore(
  storage: KeyValueStorage | null = browserStorage(),
): OnboardingStore {
  return createStore<OnboardingState>()((set, get) => {
    const save = (): void => {
      const { status, usedSeconds, homeCity, alerts } = get();
      writeJson(storage, ONBOARDING_STORAGE_KEY, { status, usedSeconds, homeCity, alerts });
    };
    return {
      ...load(storage),
      open: false,

      addUse(seconds) {
        const { status, usedSeconds } = get();
        if (status !== 'pending' || !(seconds > 0)) return;
        const next = usedSeconds + seconds;
        set({ usedSeconds: next });
        if (
          Math.floor(next / USE_WRITE_EVERY_SECONDS) >
          Math.floor(usedSeconds / USE_WRITE_EVERY_SECONDS)
        ) {
          save();
        }
      },

      show() {
        if (get().status === 'pending' && !get().open) set({ open: true });
      },

      finish(status) {
        set({ status, open: false });
        save();
      },

      setHomeCity(homeCity) {
        set({ homeCity });
        save();
      },

      setAlerts(alerts) {
        set({ alerts });
        save();
      },
    };
  });
}

/** The app's single onboarding store. */
export const onboardingStore: OnboardingStore = createOnboardingStore();

export function useOnboardingStore<T>(selector: (state: OnboardingState) => T): T {
  return useStore(onboardingStore, selector);
}
