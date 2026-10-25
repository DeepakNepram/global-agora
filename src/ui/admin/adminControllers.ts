import { fetchPlaces } from '@/core';
import type { DbConfig } from '@/core/db';
// Directly, not through the barrel: only the /admin chunk carries these.
import {
  appealsStore,
  createAppealsController,
  type AppealsController,
} from '@/state/adminAppeals';
import { createConsoleController, type ConsoleController } from '@/state/adminConsole';
import { consoleStore } from '@/state/adminConsoleStore';
import {
  createLocationsController,
  locationsStore,
  type LocationsController,
} from '@/state/adminLocations';
import { loadAdminSession, sharedSession } from '@/state/adminSession';
import { createQueueController, queueStore, type QueueController } from '@/state/moderationQueue';

/** The console's controllers, sharing one connection. */
export interface AdminControllers {
  readonly console: ConsoleController;
  readonly queue: QueueController;
  readonly appeals: AppealsController;
  readonly locations: LocationsController;
}

export function createAdminControllers(dbConfig: DbConfig): AdminControllers {
  const connect = sharedSession(() => loadAdminSession(dbConfig));
  return {
    console: createConsoleController({ store: consoleStore, connect }),
    queue: createQueueController({ store: queueStore, load: connect }),
    appeals: createAppealsController({ store: appealsStore, connect }),
    locations: createLocationsController({
      store: locationsStore,
      connect,
      // BASE_URL is resolved here, not in src/core, which must not read Vite globals.
      loadPlaces: () =>
        fetchPlaces(import.meta.env.BASE_URL, { fetch: (url, init) => fetch(url, init) }),
    }),
  };
}
