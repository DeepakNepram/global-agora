import { describe, expect, it, vi } from 'vitest';

import { handleFetch, handleScheduled, secretMatches, type AppDeps } from '../src/app.ts';
import { DEFAULT_CONFIG, resolveConfig } from '../src/config.ts';
import { createServiceDb, DbError } from '../src/db/service.ts';
import type { Fetch } from '../src/gdelt/feed.ts';
import { createLogger } from '../src/log.ts';
import type { RunDeps } from '../src/pipeline/run.ts';

const SECRET = 'correct-horse-battery-staple-0123456789';

/** A run that finds nothing to do: enough to exercise the routes. */
function idleRun(): RunDeps {
  return {
    feed: {
      latestListedSlot: async () => '20260924084500',
      hasSlot: async () => false,
      fetchSlot: async () => null,
    },
    db: {
      cursor: async () => '2026-09-24T08:30:00Z',
      claim: async () => true,
      finish: async () => 'skipped',
      knownUrls: async () => new Set(),
      candidates: async () => [],
      apply: async () => ({ stories_new: 0, stories_updated: 0, articles_new: 0 }),
      prune: async () => ({
        stories_deleted: 0,
        stories_kept_for_discussion: 0,
        runs_deleted: 0,
        signals_deleted: 0,
      }),
    },
    fetch: async () => new Response(null),
    outletCountry: () => null,
    config: DEFAULT_CONFIG,
    log: createLogger({}, () => {}),
    now: () => Date.UTC(2026, 8, 24, 9, 0) / 1000,
    newId: () => 'id',
  };
}

function app(overrides: Partial<AppDeps> = {}, lines: string[] = []): AppDeps {
  return {
    run: idleRun,
    triggerSecret: SECRET,
    log: createLogger({}, (line) => lines.push(line)),
    ...overrides,
  };
}

const request = (path: string, init: RequestInit = {}): Request =>
  new Request(`https://ingest.example${path}`, init);
const bearer = (token: string): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
});

describe('routes', () => {
  it('answers health checks without data', async () => {
    const response = await handleFetch(request('/health'), app());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('runs on POST /run with the right secret', async () => {
    const response = await handleFetch(request('/run', bearer(SECRET)), app());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { slots: { status: string }[] };
    expect(body.slots.map((s) => s.status)).toEqual(['not_published']);
  });

  it('refuses a wrong or missing secret', async () => {
    const lines: string[] = [];
    const wrong = await handleFetch(request('/run', bearer(`${SECRET}x`)), app({}, lines));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('www-authenticate')).toBe('Bearer');
    const missing = await handleFetch(request('/run', { method: 'POST' }), app());
    expect(missing.status).toBe(401);
    expect(lines.some((line) => line.includes('trigger.denied'))).toBe(true);
  });

  it('stays closed until a strong secret is configured', async () => {
    const unset = await handleFetch(request('/run', bearer('')), app({ triggerSecret: undefined }));
    expect(unset.status).toBe(503);
    const weak = await handleFetch(
      request('/run', bearer('short')),
      app({ triggerSecret: 'short' }),
    );
    expect(weak.status).toBe(503);
  });

  it('only accepts POST on /run and GET on /health', async () => {
    const get = await handleFetch(
      request('/run', { headers: { authorization: `Bearer ${SECRET}` } }),
      app(),
    );
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await handleFetch(request('/health', { method: 'POST' }), app())).status).toBe(405);
  });

  it('checks the slot parameter before running', async () => {
    const response = await handleFetch(request('/run?slot=yesterday', bearer(SECRET)), app());
    expect(response.status).toBe(400);
  });

  it('answers 404 for anything else', async () => {
    expect((await handleFetch(request('/'), app())).status).toBe(404);
    expect((await handleFetch(request('/run/extra', bearer(SECRET)), app())).status).toBe(404);
  });

  it('reports a run that cannot start instead of crashing', async () => {
    const broken = app({
      run: () => {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
      },
    });
    const response = await handleFetch(request('/run', bearer(SECRET)), broken);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set',
    });
  });

  it('logs a failed cron run rather than throwing', async () => {
    const lines: string[] = [];
    const broken = app(
      {
        run: () => {
          throw new Error('no config');
        },
      },
      lines,
    );
    await expect(handleScheduled('*/15 * * * *', broken)).resolves.toBeUndefined();
    const logged = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
    expect(logged).toMatchObject({ level: 'error', event: 'run.error', cron: '*/15 * * * *' });
  });

  it('compares secrets by digest', async () => {
    expect(await secretMatches(SECRET, SECRET)).toBe(true);
    expect(await secretMatches('', SECRET)).toBe(false);
    expect(await secretMatches(SECRET.slice(0, -1), SECRET)).toBe(false);
  });
});

describe('service database client', () => {
  function recorder(
    body: unknown = true,
    status = 200,
  ): { fetch: Fetch; calls: { url: string; init: RequestInit | undefined }[] } {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    return {
      calls,
      fetch: vi.fn<Fetch>(async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status });
      }),
    };
  }

  it('calls PostgREST RPCs with the service key', async () => {
    const { fetch, calls } = recorder(true);
    const db = createServiceDb('http://127.0.0.1:54321/', 'eyJ.service.jwt', fetch);
    await expect(db.claim('2026-09-24T08:45:00.000Z')).resolves.toBe(true);
    expect(calls[0]?.url).toBe('http://127.0.0.1:54321/rest/v1/rpc/ingest_claim');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers).toMatchObject({
      apikey: 'eyJ.service.jwt',
      authorization: 'Bearer eyJ.service.jwt',
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      p_slot: '2026-09-24T08:45:00.000Z',
    });
  });

  it('sends a new-style secret key as apikey only', async () => {
    const { fetch, calls } = recorder([]);
    await createServiceDb('http://db.example', 'sb_secret_abc', fetch).knownUrls([
      'https://a.example/x',
    ]);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['apikey']).toBe('sb_secret_abc');
    expect(headers['authorization']).toBeUndefined();
  });

  it('skips calls with nothing to ask', async () => {
    const { fetch, calls } = recorder([]);
    const db = createServiceDb('http://db.example', 'k', fetch);
    await expect(db.knownUrls([])).resolves.toEqual(new Set());
    await expect(db.candidates([], '2026-09-24T00:00:00Z')).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it('chunks lookups to stay under the PostgREST row limit', async () => {
    const { fetch, calls } = recorder([]);
    const urls = Array.from({ length: 2000 }, (_, i) => `https://a.example/${i}`);
    await createServiceDb('http://db.example', 'k', fetch).knownUrls(urls);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => JSON.parse(String(c.init?.body)).p_urls.length <= 900)).toBe(true);
  });

  it('refuses a page at the row limit instead of trusting it', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => `https://a.example/${i}`);
    const { fetch } = recorder(full);
    await expect(
      createServiceDb('http://db.example', 'k', fetch).knownUrls(['https://a.example/x']),
    ).rejects.toThrow(/PostgREST limit/);
  });

  it('reads the cursor from the run ledger', async () => {
    const { fetch, calls } = recorder([{ slot: '2026-09-24T08:30:00+00:00' }]);
    await expect(createServiceDb('http://db.example', 'k', fetch).cursor()).resolves.toBe(
      '2026-09-24T08:30:00+00:00',
    );
    expect(calls[0]?.url).toBe(
      'http://db.example/rest/v1/ingest_runs?select=slot&status=in.(done,skipped)&order=slot.desc&limit=1',
    );
  });

  it('turns an error response into a DbError with the body', async () => {
    const { fetch } = recorder({ message: 'permission denied' }, 403);
    await expect(createServiceDb('http://db.example', 'k', fetch).claim('x')).rejects.toThrow(
      DbError,
    );
  });
});

describe('config', () => {
  it('defaults every value', () => {
    expect(resolveConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it('reads overrides and ignores values out of range', () => {
    const config = resolveConfig({
      INGEST_QUEUE_HEAT: '230',
      INGEST_HEAT_WEIGHTS: '0.6, 0.2, 0.2',
      INGEST_RETENTION_HOURS: '1',
      INGEST_MAX_SLOTS_PER_RUN: 'lots',
      GDELT_BASE_URL: 'http://insecure.example',
    });
    expect(config.queueHeat).toBe(230);
    expect(config.heat.weights).toEqual({ sources: 0.6, countries: 0.2, velocity: 0.2 });
    expect(config.retentionHours).toBe(DEFAULT_CONFIG.retentionHours);
    expect(config.maxSlotsPerRun).toBe(DEFAULT_CONFIG.maxSlotsPerRun);
    expect(config.gdeltBaseUrl).toBe(DEFAULT_CONFIG.gdeltBaseUrl);
  });
});
