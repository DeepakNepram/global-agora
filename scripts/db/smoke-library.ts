/**
 * db:smoke's account checks (Prompt 3.4): two throwaway users on the LOCAL
 * stack, one moving a device's library up (twice, as a retry would), the
 * other unable to see or delete it. The users are made and removed through
 * the local admin API with the CLI's local service key, read from
 * `supabase status`; passwords are random per run and never printed.
 */
import { randomUUID } from 'node:crypto';

import { createDbClient, type DbConfig } from '../../src/core/db/client.ts';
import { createLibraryRemote } from '../../src/core/db/library.ts';
import type { Follow } from '../../src/core/follows.ts';
import type { SavedStory } from '../../src/core/library.ts';

export type Record = (check: string, ok: boolean, detail: string) => void;

interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

async function admin(
  config: DbConfig,
  serviceKey: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(`${config.url}/auth/v1/admin/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
  });
}

async function createUser(config: DbConfig, serviceKey: string, name: string): Promise<TestUser> {
  const email = `smoke-${name}-${randomUUID().slice(0, 8)}@test.example`;
  const password = randomUUID();
  const response = await admin(config, serviceKey, 'users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok) throw new Error(`creating a test user: HTTP ${response.status}`);
  const body = (await response.json()) as { id?: string };
  if (typeof body.id !== 'string') throw new Error('creating a test user: no id');
  return { id: body.id, email, password };
}

async function signedIn(
  config: DbConfig,
  user: TestUser,
): Promise<ReturnType<typeof createDbClient>> {
  const client = createDbClient(config, { persistSession: false });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`signing in a test user: ${error.message}`);
  return client;
}

const DEVICE_FOLLOWS: Follow[] = [
  { kind: 'category', target: 'tech', label: 'Tech', baseline: null, createdAtMs: Date.now() },
  { kind: 'place', target: 'country:JP', label: 'Japan', baseline: null, createdAtMs: Date.now() },
  { kind: 'story', target: '7', label: 'Smoke story', baseline: 3, createdAtMs: Date.now() },
];
const DEVICE_SAVED: SavedStory[] = [
  {
    id: 7,
    headline: 'Smoke story',
    place: 'London',
    publishedAtMs: Date.now(),
    savedAtMs: Date.now(),
  },
];

export async function libraryChecks(
  config: DbConfig,
  serviceKey: string,
  record: Record,
): Promise<void> {
  const users: TestUser[] = [];
  try {
    const a = await createUser(config, serviceKey, 'a');
    users.push(a);
    const b = await createUser(config, serviceKey, 'b');
    users.push(b);
    const remoteA = createLibraryRemote(await signedIn(config, a));
    const remoteB = createLibraryRemote(await signedIn(config, b));

    // Moving up twice, as a retry after a dropped connection would.
    await remoteA.addFollows(DEVICE_FOLLOWS);
    await remoteA.addSaved(DEVICE_SAVED);
    await remoteA.addFollows(DEVICE_FOLLOWS);
    await remoteA.addSaved(DEVICE_SAVED);
    const follows = await remoteA.listFollows();
    const saved = await remoteA.listSaved();
    record(
      'a device library moved up twice is there once',
      follows.length === 3 && saved.length === 1,
      `${follows.length} follows, ${saved.length} saved`,
    );
    record(
      'a followed story keeps its baseline',
      follows.find((f) => f.kind === 'story')?.baseline === 3,
      `baseline ${String(follows.find((f) => f.kind === 'story')?.baseline)}`,
    );

    const seenByB = (await remoteB.listFollows()).length + (await remoteB.listSaved()).length;
    record('another user sees none of it', seenByB === 0, `${seenByB} rows`);
    await remoteB.removeFollow('category', 'tech');
    await remoteB.removeSaved(7);
    const afterB = (await remoteA.listFollows()).length + (await remoteA.listSaved()).length;
    record('another user cannot delete it', afterB === 4, `${afterB} rows left`);

    await remoteA.removeFollow('category', 'tech');
    await remoteA.removeSaved(7);
    const afterA = (await remoteA.listFollows()).length + (await remoteA.listSaved()).length;
    record('its owner can', afterA === 2, `${afterA} rows left`);
  } catch (error) {
    record('library checks ran', false, error instanceof Error ? error.message : String(error));
  } finally {
    for (const user of users) {
      await admin(config, serviceKey, `users/${user.id}`, { method: 'DELETE' });
    }
  }
}
