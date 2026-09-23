import type { FrameSummary } from '@/core';

/** One measured run, flattened for a JSON line. */
export interface BenchRow {
  /** Which off/on pair the run belongs to. */
  readonly pair: number;
  /** Pins drawn; 0 is the baseline. */
  readonly pins: number;
  readonly buffer: string | null;
  /** The page was hidden during the run (screen off, app switch); excluded from the summary. */
  readonly interrupted: boolean;
  readonly fps: number | null;
  readonly intervalMeanMs: number | null;
  readonly intervalP95Ms: number | null;
  readonly cpuMeanMs: number | null;
  readonly gpuMeanMs: number | null;
  readonly gpuP95Ms: number | null;
}

export interface BenchStep {
  /** -1 is the warm-up run, which is measured but discarded. */
  readonly pair: number;
  readonly pins: number;
}

export interface PairedSummary {
  /** Pairs with both runs complete and uninterrupted. */
  readonly pairs: number;
  readonly baselineFps: number | null;
  readonly pinsFps: number | null;
  /** Median over pairs of (pins interval − baseline interval): the pins' cost per frame. */
  readonly pinCostMs: number | null;
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

export function benchRow(
  step: BenchStep,
  summary: FrameSummary,
  buffer: string | null,
  interrupted: boolean,
): BenchRow {
  return {
    pair: step.pair,
    pins: step.pins,
    buffer,
    interrupted,
    fps: summary.intervalMeanMs ? round(1000 / summary.intervalMeanMs) : null,
    intervalMeanMs: round(summary.intervalMeanMs),
    intervalP95Ms: round(summary.intervalP95Ms),
    cpuMeanMs: round(summary.cpuMeanMs),
    gpuMeanMs: round(summary.gpuMeanMs),
    gpuP95Ms: round(summary.gpuP95Ms),
  };
}

/**
 * A warm-up run, then `pairs` baseline/pins pairs whose order alternates. A
 * phone heats up and slows over a run of runs; alternating spreads that drift
 * over both sides instead of billing it all to whichever always ran last.
 */
export function pairedSchedule(pairs: number, pins: number): BenchStep[] {
  const steps: BenchStep[] = [{ pair: -1, pins }];
  for (let pair = 0; pair < pairs; pair++) {
    const order = pair % 2 === 0 ? [0, pins] : [pins, 0];
    for (const count of order) steps.push({ pair, pins: count });
  }
  return steps;
}

/** Middle value; the mean of the two middle values for an even count. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const upper = sorted[middle] ?? NaN;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? NaN) + upper) / 2;
}

/** Medians over the usable pairs. A pair counts only if both of its runs are clean. */
export function summarisePairs(rows: readonly BenchRow[]): PairedSummary {
  const usable = rows.filter((row) => !row.interrupted && row.intervalMeanMs !== null);
  const deltas: number[] = [];
  const baseline: number[] = [];
  const loaded: number[] = [];
  const pairIds = new Set(usable.map((row) => row.pair));
  for (const pair of pairIds) {
    const off = usable.find((row) => row.pair === pair && row.pins === 0);
    const on = usable.find((row) => row.pair === pair && row.pins > 0);
    if (!off?.intervalMeanMs || !on?.intervalMeanMs) continue;
    deltas.push(on.intervalMeanMs - off.intervalMeanMs);
    baseline.push(1000 / off.intervalMeanMs);
    loaded.push(1000 / on.intervalMeanMs);
  }
  return {
    pairs: deltas.length,
    baselineFps: round(median(baseline)),
    pinsFps: round(median(loaded)),
    pinCostMs: round(median(deltas)),
  };
}

/**
 * Hands a benchmark to the dev server (vite.config.ts, `POST /__bench`), which
 * appends it to .bench/results.jsonl. That is how a phone's numbers reach the
 * developer's machine. Dev builds only: production has no such route, and
 * nothing is ever sent anywhere but the server that served the page.
 */
export async function postBenchReport(report: Record<string, unknown>): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const response = await fetch('/__bench', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    return response.ok;
  } catch {
    return false;
  }
}
