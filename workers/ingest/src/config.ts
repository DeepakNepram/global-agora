/**
 * Ingest tuning, from Worker vars with defaults. Nothing that could become a
 * plan limit or needs tuning against real traffic is a literal in the code.
 */

import { DEFAULT_HEAT, type HeatConfig } from './score/heat.ts';

export interface IngestConfig {
  readonly gdeltBaseUrl: string;
  /** Heat at which a story is queued for a discussion (the seed uses 215 too). */
  readonly queueHeat: number;
  readonly heat: HeatConfig;
  /** Slots one run may process, so a backlog is caught up gradually. */
  readonly maxSlotsPerRun: number;
  /** Further behind than this, skip ahead to the newest slot instead of catching up. */
  readonly maxLagHours: number;
  /** A slot still 404 this long after its time is missing, not late. */
  readonly missingAfterMinutes: number;
  /** Stories first published longer ago than this are deleted. */
  readonly retentionHours: number;
  readonly runRetentionDays: number;
  /** New articles only join stories seen within this window. */
  readonly matchWindowHours: number;
  /** Redirector lookups per run (each is a subrequest). */
  readonly redirectBudget: number;
}

export const DEFAULT_CONFIG: IngestConfig = {
  gdeltBaseUrl: 'https://data.gdeltproject.org/gdeltv2',
  queueHeat: 215,
  heat: DEFAULT_HEAT,
  maxSlotsPerRun: 2,
  maxLagHours: 6,
  missingAfterMinutes: 180,
  retentionHours: 48,
  runRetentionDays: 7,
  matchWindowHours: 24,
  redirectBudget: 25,
};

export type Vars = Readonly<Record<string, unknown>>;

function num(vars: Vars, key: string, fallback: number, min: number, max: number): number {
  const raw = vars[key];
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function triple(
  vars: Vars,
  key: string,
  fallback: readonly [number, number, number],
): [number, number, number] {
  const raw = vars[key];
  if (typeof raw !== 'string') return [...fallback];
  const parts = raw.split(',').map((part) => Number(part.trim()));
  return parts.length === 3 && parts.every((p) => Number.isFinite(p) && p >= 0)
    ? [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
    : [...fallback];
}

export function resolveConfig(vars: Vars): IngestConfig {
  const d = DEFAULT_CONFIG;
  const w = triple(vars, 'INGEST_HEAT_WEIGHTS', [
    d.heat.weights.sources,
    d.heat.weights.countries,
    d.heat.weights.velocity,
  ]);
  const k = triple(vars, 'INGEST_HEAT_SATURATION', [
    d.heat.saturation.sources,
    d.heat.saturation.countries,
    d.heat.saturation.velocity,
  ]);
  const base = vars['GDELT_BASE_URL'];

  return {
    gdeltBaseUrl: typeof base === 'string' && /^https:\/\//.test(base) ? base : d.gdeltBaseUrl,
    queueHeat: num(vars, 'INGEST_QUEUE_HEAT', d.queueHeat, 1, 255),
    heat: {
      weights: { sources: w[0], countries: w[1], velocity: w[2] },
      saturation: { sources: k[0], countries: k[1], velocity: k[2] },
      syndicatedWeight: num(vars, 'INGEST_SYNDICATED_WEIGHT', d.heat.syndicatedWeight, 0, 1),
    },
    maxSlotsPerRun: num(vars, 'INGEST_MAX_SLOTS_PER_RUN', d.maxSlotsPerRun, 1, 8),
    maxLagHours: num(vars, 'INGEST_MAX_LAG_HOURS', d.maxLagHours, 1, 48),
    missingAfterMinutes: num(vars, 'INGEST_MISSING_AFTER_MINUTES', d.missingAfterMinutes, 30, 1440),
    retentionHours: num(vars, 'INGEST_RETENTION_HOURS', d.retentionHours, 24, 24 * 30),
    runRetentionDays: num(vars, 'INGEST_RUN_RETENTION_DAYS', d.runRetentionDays, 1, 90),
    matchWindowHours: num(vars, 'INGEST_MATCH_WINDOW_HOURS', d.matchWindowHours, 1, 72),
    redirectBudget: num(vars, 'INGEST_REDIRECT_BUDGET', d.redirectBudget, 0, 500),
  };
}
