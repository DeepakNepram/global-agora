/**
 * Cloudflare Worker: GDELT ingest every 15 minutes, plus a manual trigger.
 *
 * Secrets (never in the client, CLAUDE.md #9): SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, INGEST_TRIGGER_SECRET. Tuning vars are listed in
 * src/config.ts. Needs the Workers Paid plan: a batch takes ~100 ms of CPU,
 * over the free plan's 10 ms per cron run.
 */

import { handleFetch, handleScheduled, type AppDeps } from './app.ts';
import { resolveConfig, type Vars } from './config.ts';
import outletList from './data/outlet-countries.txt';
import { createServiceDb } from './db/service.ts';
import { createFeed } from './gdelt/feed.ts';
import { createLogger } from './log.ts';
import { createOutletCountries } from './normalize/outlets.ts';
import type { RunDeps } from './pipeline/run.ts';

interface Env extends Vars {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly INGEST_TRIGGER_SECRET?: string;
}

/** The Cloudflare runtime objects this Worker touches (a subset of workers-types). */
interface ScheduledController {
  readonly cron: string;
}

// Module scope: the lookup table is built once per isolate, on first use.
const outletCountry = createOutletCountries(outletList);

function deps(env: Env): AppDeps {
  const log = createLogger({ worker: 'ingest', runId: crypto.randomUUID() });
  return {
    log,
    triggerSecret: env.INGEST_TRIGGER_SECRET,
    run: (): RunDeps => {
      const url = env.SUPABASE_URL;
      const key = env.SUPABASE_SERVICE_ROLE_KEY;
      if (url === undefined || url === '' || key === undefined || key === '') {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
      }
      const config = resolveConfig(env);
      return {
        feed: createFeed(config.gdeltBaseUrl),
        db: createServiceDb(url, key),
        fetch: (input, init) => fetch(input, init),
        outletCountry,
        config,
        log,
        now: () => Date.now() / 1000,
        newId: () => crypto.randomUUID(),
      };
    },
  };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleFetch(request, deps(env));
  },
  scheduled(controller: ScheduledController, env: Env): Promise<void> {
    return handleScheduled(controller.cron, deps(env));
  },
};
