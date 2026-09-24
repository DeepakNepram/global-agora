/**
 * Runtime configuration.
 *
 * CLAUDE.md: "Never hardcode a limit that might become a paid tier boundary."
 * Every number here is therefore a resolved value with a free-tier default, not
 * a literal sprinkled through the codebase. When `profiles.tier` starts being
 * read, the paid values override these — nothing else has to change.
 *
 * This module takes an env bag as an argument rather than reading
 * `import.meta.env` directly, so src/core stays free of bundler globals and can
 * run unchanged under a native shell or in a Worker.
 */

export interface AppConfig {
  /** How far back the time scrubber can reach, in hours. Paid tiers extend this. */
  readonly historyWindowHours: number;
  /** Max saved stories per account. */
  readonly savedStoryLimit: number;
  /** Max active alerts per account. */
  readonly alertLimit: number;
  /** Hard product constraint, mirrored by a CHECK constraint on posts.body. */
  readonly maxPostLength: number;
  /** Base URL of the Workers API that serves the columnar payload. */
  readonly apiBaseUrl: string;
  /**
   * How often the globe re-checks the payload. Ingest writes every 15 minutes
   * and the API caches for 60 s; an unchanged check is a bodiless 304.
   */
  readonly payloadRefreshSeconds: number;
}

export type EnvBag = Readonly<Record<string, string | undefined>>;

export const FREE_TIER_DEFAULTS: AppConfig = {
  historyWindowHours: 24,
  savedStoryLimit: 50,
  alertLimit: 5,
  maxPostLength: 500,
  apiBaseUrl: '/api',
  payloadRefreshSeconds: 120,
};

function readInt(env: EnvBag, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readString(env: EnvBag, key: string, fallback: string): string {
  const raw = env[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

export function resolveConfig(env: EnvBag): AppConfig {
  return {
    historyWindowHours: readInt(
      env,
      'VITE_HISTORY_WINDOW_HOURS',
      FREE_TIER_DEFAULTS.historyWindowHours,
    ),
    savedStoryLimit: readInt(env, 'VITE_SAVED_STORY_LIMIT', FREE_TIER_DEFAULTS.savedStoryLimit),
    alertLimit: readInt(env, 'VITE_ALERT_LIMIT', FREE_TIER_DEFAULTS.alertLimit),
    maxPostLength: readInt(env, 'VITE_MAX_POST_LENGTH', FREE_TIER_DEFAULTS.maxPostLength),
    apiBaseUrl: readString(env, 'VITE_API_BASE_URL', FREE_TIER_DEFAULTS.apiBaseUrl),
    payloadRefreshSeconds: readInt(
      env,
      'VITE_PAYLOAD_REFRESH_SECONDS',
      FREE_TIER_DEFAULTS.payloadRefreshSeconds,
    ),
  };
}
