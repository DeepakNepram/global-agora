/**
 * The moderate-post function's settings, read once per request from env.
 *
 * Production: MODERATION_HOOK_SECRET, OPENAI_API_KEY and GOOGLE_API_KEY via
 * `supabase secrets set`; SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come
 * from the platform.
 *
 * Local only: MODERATION_STAND_IN_URL sends any model without a key to a
 * stand-in serving recorded replies (db:smoke runs one), so the pipeline is
 * testable before every key exists. Both it and the public local hook
 * secret are refused against a hosted project.
 */

export interface ModelAccess {
  readonly apiKey: string;
  /** Set only for a stand-in; a real model uses its own address. */
  readonly baseUrl?: string | undefined;
  readonly standIn: boolean;
}

export interface ModerationEnv {
  readonly hookSecret: string;
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly openai: ModelAccess;
  readonly google: ModelAccess;
}

/** The local stack's hook secret (supabase/seeds/local-moderation.sql). Public. */
export const LOCAL_HOOK_SECRET = 'local-only-moderation-hook';

/** How the local stack names itself to the function. */
const LOCAL_HOSTS = new Set(['kong', 'localhost', '127.0.0.1', 'host.docker.internal']);

function value(get: (name: string) => string | undefined, name: string): string | null {
  const raw = get(name)?.trim();
  return raw === undefined || raw === '' ? null : raw;
}

/** The settings, or why the function cannot run (a 500: the post waits, pending). */
export function moderationEnv(get: (name: string) => string | undefined): ModerationEnv | string {
  const hookSecret = value(get, 'MODERATION_HOOK_SECRET');
  const supabaseUrl = value(get, 'SUPABASE_URL');
  const serviceRoleKey = value(get, 'SUPABASE_SERVICE_ROLE_KEY');
  const standIn = value(get, 'MODERATION_STAND_IN_URL');

  let local: boolean;
  try {
    local = supabaseUrl !== null && LOCAL_HOSTS.has(new URL(supabaseUrl).hostname);
  } catch {
    return 'not configured: SUPABASE_URL is not a URL';
  }
  if (!local && hookSecret === LOCAL_HOOK_SECRET) {
    return 'the local hook secret cannot serve a hosted project';
  }
  if (!local && standIn !== null) return 'a stand-in model cannot serve a hosted project';

  const access = (keyName: string): ModelAccess | null => {
    const apiKey = value(get, keyName);
    if (apiKey !== null) return { apiKey, standIn: false };
    return standIn === null ? null : { apiKey: 'stand-in', baseUrl: standIn, standIn: true };
  };
  const openai = access('OPENAI_API_KEY');
  const google = access('GOOGLE_API_KEY');

  const missing = [
    hookSecret === null && 'MODERATION_HOOK_SECRET',
    supabaseUrl === null && 'SUPABASE_URL',
    serviceRoleKey === null && 'SUPABASE_SERVICE_ROLE_KEY',
    openai === null && 'OPENAI_API_KEY',
    google === null && 'GOOGLE_API_KEY',
  ].filter((name): name is string => name !== false);
  if (
    missing.length > 0 ||
    hookSecret === null ||
    supabaseUrl === null ||
    serviceRoleKey === null ||
    openai === null ||
    google === null
  ) {
    return `not configured: ${missing.join(', ')}`;
  }
  return { hookSecret, supabaseUrl, serviceRoleKey, openai, google };
}
