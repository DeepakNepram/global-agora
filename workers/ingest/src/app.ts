/**
 * The Worker's two entry points, free of Worker globals so tests can drive
 * them: the cron handler, and a small HTTP surface.
 *
 *   GET  /health  200, no data
 *   POST /run     run now; `Authorization: Bearer <INGEST_TRIGGER_SECRET>`
 *                 ?slot=YYYYMMDDHHMMSS  process that slot only
 *                 ?dry=1                compute everything, write nothing
 *
 * Everything else is 404. The secret is compared in constant time, and the
 * route stays closed until a secret of at least 32 characters is configured.
 */

import { errorFields, type Logger } from './log.ts';
import { runIngest, type RunDeps } from './pipeline/run.ts';

export const MIN_SECRET_LENGTH = 32;

export interface AppDeps {
  /** Built per invocation; throws if the Worker is missing configuration. */
  readonly run: () => RunDeps;
  readonly triggerSecret: string | undefined;
  readonly log: Logger;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/**
 * Compares digests, not the strings: equal-length inputs make the loop's
 * timing independent of where they differ, and of the secret's length.
 */
export async function secretMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

async function handleRun(request: Request, deps: AppDeps): Promise<Response> {
  if (request.method !== 'POST')
    return json({ error: 'method not allowed' }, 405, { allow: 'POST' });

  const secret = deps.triggerSecret;
  if (secret === undefined || secret.length < MIN_SECRET_LENGTH) {
    return json({ error: 'manual trigger disabled: set INGEST_TRIGGER_SECRET' }, 503);
  }
  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!(await secretMatches(given, secret))) {
    deps.log.warn('trigger.denied');
    return json({ error: 'unauthorized' }, 401, { 'www-authenticate': 'Bearer' });
  }

  const params = new URL(request.url).searchParams;
  const slot = params.get('slot') ?? undefined;
  if (slot !== undefined && !/^\d{14}$/.test(slot)) {
    return json({ error: 'slot must be YYYYMMDDHHMMSS' }, 400);
  }
  try {
    const summary = await runIngest(deps.run(), {
      trigger: 'manual',
      ...(slot === undefined ? {} : { slot }),
      dryRun: params.get('dry') === '1',
    });
    return json(summary);
  } catch (error) {
    deps.log.error('run.error', errorFields(error));
    return json({ error: error instanceof Error ? error.message : 'run failed' }, 500);
  }
}

export async function handleFetch(request: Request, deps: AppDeps): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/health') {
    return request.method === 'GET'
      ? json({ ok: true })
      : json({ error: 'method not allowed' }, 405, { allow: 'GET' });
  }
  if (pathname === '/run') return handleRun(request, deps);
  return json({ error: 'not found' }, 404);
}

export async function handleScheduled(cron: string, deps: AppDeps): Promise<void> {
  try {
    await runIngest(deps.run(), { trigger: 'cron' });
  } catch (error) {
    deps.log.error('run.error', { cron, ...errorFields(error) });
  }
}
