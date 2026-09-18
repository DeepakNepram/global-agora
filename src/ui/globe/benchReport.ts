import type { FrameSummary } from '@/core';

/** One configuration's result, flattened for a JSON line. */
export interface BenchRow {
  readonly label: string;
  readonly buffer: string | null;
  readonly fps: number | null;
  readonly intervalMeanMs: number | null;
  readonly intervalP95Ms: number | null;
  readonly cpuMeanMs: number | null;
  readonly gpuMeanMs: number | null;
  readonly gpuP95Ms: number | null;
}

export function benchRow(label: string, summary: FrameSummary, buffer: string | null): BenchRow {
  const round = (value: number | null): number | null =>
    value === null ? null : Math.round(value * 100) / 100;
  return {
    label,
    buffer,
    fps: summary.intervalMeanMs ? round(1000 / summary.intervalMeanMs) : null,
    intervalMeanMs: round(summary.intervalMeanMs),
    intervalP95Ms: round(summary.intervalP95Ms),
    cpuMeanMs: round(summary.cpuMeanMs),
    gpuMeanMs: round(summary.gpuMeanMs),
    gpuP95Ms: round(summary.gpuP95Ms),
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
