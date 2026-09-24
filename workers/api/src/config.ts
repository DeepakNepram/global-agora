/**
 * API tuning, from Worker vars with defaults. The history window and node
 * count are tier boundaries in waiting (CLAUDE.md: never hardcode one), and
 * the cache timings need tuning against real traffic, so none is a literal.
 */

export interface ApiConfig {
  /** Nodes per payload: the hottest this many in the window. */
  readonly nodeLimit: number;
  /** Longest window a client may ask for, in hours (free tier: 24). */
  readonly maxHours: number;
  /** How long a cached response counts as fresh. */
  readonly ttlSeconds: number;
  /** After that, how long it is still served while a refresh runs. */
  readonly staleSeconds: number;
  /** How long it is still served when a refresh fails. */
  readonly staleIfErrorSeconds: number;
  /** Brotli quality for the payload: 11 is ~0.5 s of CPU per rebuild and 131 KB. */
  readonly brotliQuality: number;
  /** Articles returned with one story (article_count is the true total). */
  readonly storyArticleLimit: number;
  /** Origins allowed to call the API cross-origin; empty means same-origin only. */
  readonly allowedOrigins: readonly string[];
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  nodeLimit: 3000,
  maxHours: 24,
  ttlSeconds: 60,
  staleSeconds: 900,
  staleIfErrorSeconds: 86_400,
  brotliQuality: 11,
  storyArticleLimit: 1000,
  allowedOrigins: [],
};

export type Vars = Readonly<Record<string, unknown>>;

function int(vars: Vars, key: string, fallback: number, min: number, max: number): number {
  const raw = vars[key];
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function origins(vars: Vars, key: string): string[] {
  const raw = vars[key];
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => /^https?:\/\/[^/]+$/.test(origin));
}

export function resolveApiConfig(vars: Vars): ApiConfig {
  const d = DEFAULT_API_CONFIG;
  return {
    // Upper bounds match api_nodes' own safety limits.
    nodeLimit: int(vars, 'API_NODE_LIMIT', d.nodeLimit, 1, 10_000),
    maxHours: int(vars, 'API_MAX_HOURS', d.maxHours, 1, 720),
    ttlSeconds: int(vars, 'API_CACHE_TTL_SECONDS', d.ttlSeconds, 1, 3600),
    staleSeconds: int(vars, 'API_STALE_SECONDS', d.staleSeconds, 0, 86_400),
    staleIfErrorSeconds: int(vars, 'API_STALE_IF_ERROR_SECONDS', d.staleIfErrorSeconds, 0, 604_800),
    brotliQuality: int(vars, 'API_BROTLI_QUALITY', d.brotliQuality, 1, 11),
    storyArticleLimit: int(vars, 'API_STORY_ARTICLE_LIMIT', d.storyArticleLimit, 1, 5000),
    allowedOrigins: origins(vars, 'API_ALLOWED_ORIGINS'),
  };
}
