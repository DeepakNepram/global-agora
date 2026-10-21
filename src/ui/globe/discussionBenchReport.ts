import { percentile } from '@/core';

import type { FrameCapture } from './frameProbe';

/**
 * The discussion benchmark's numbers (Prompt 4.5), from what it recorded:
 * every animation frame the page got (the panel's frame rate as the main
 * thread sees it) and every frame the globe drew (the probe), split into
 * the windows Prompt 4.5 asks about. Pure, so the arithmetic is tested.
 */

export interface WindowStats {
  readonly frames: number;
  readonly intervalP50Ms: number | null;
  readonly intervalP95Ms: number | null;
  readonly intervalMaxMs: number | null;
  /** Frames later than one vsync plus jitter: a frame the display had to wait for. */
  readonly missed: number;
  /**
   * Frames later than a 60 fps frame (16.7 ms) plus vsync jitter: Prompt
   * 4.5's bar. On a 144 Hz display a frame can miss a vsync and still be
   * well inside it.
   */
  readonly slowerThan60fps: number;
  /** Frames the globe drew. */
  readonly draws: number;
  /** Mean time between the globe's draws: 33.3 at a steady 30 fps. */
  readonly drawMeanMs: number | null;
  readonly drawP95Ms: number | null;
  readonly gpuP50Ms: number | null;
  readonly gpuP95Ms: number | null;
}

/** Half a vsync's slack: a frame later than 1.5 vsyncs missed one. */
export const MISS_FACTOR = 1.5;

/** 60 fps, and the vsync jitter bloomReport.ts allows it (16.6–17.3 ms at 60 Hz). */
const SIXTY_FPS_MS = 1000 / 60;
const JITTER_MS = 2;

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function gaps(times: readonly number[]): number[] {
  const result: number[] = [];
  for (let i = 1; i < times.length; i++) result.push((times[i] ?? 0) - (times[i - 1] ?? 0));
  return result;
}

function p(values: readonly number[], q: number): number | null {
  return values.length === 0 ? null : round(percentile(values, q));
}

/** The vsync period: the median gap between animation frames while idle. */
export function vsyncMs(ticks: readonly number[]): number {
  const between = gaps(ticks);
  return between.length === 0 ? 1000 / 60 : (percentile(between, 50) ?? 1000 / 60);
}

/**
 * Frames inside [startMs, endMs]. The first interval reaches back to the
 * frame before the window, so a hitch at its very start counts.
 */
export function windowStats(
  ticks: readonly number[],
  capture: FrameCapture,
  startMs: number,
  endMs: number,
  vsync: number,
): WindowStats {
  // The frame before the window, every frame in it, and the first after it:
  // a window shorter than a frame (the switch back to full quality) still
  // gets the interval that spans it.
  const firstInside = ticks.findIndex((t) => t >= startMs);
  const from = firstInside > 0 ? firstInside - 1 : 0;
  const lastInside = ticks.findIndex((t) => t > endMs);
  const to = lastInside < 0 ? ticks.length : lastInside + 1;
  const inside = firstInside < 0 ? [] : ticks.slice(from, to);
  const intervals = gaps(inside);
  const draws = capture.frames
    .filter((f) => f.atMs >= startMs && f.atMs <= endMs)
    .map((f) => f.atMs);
  const drawGaps = gaps(draws);
  const gpu = capture.gpu.filter((g) => g.atMs >= startMs && g.atMs <= endMs).map((g) => g.ms);
  return {
    frames: intervals.length,
    intervalP50Ms: p(intervals, 50),
    intervalP95Ms: p(intervals, 95),
    intervalMaxMs: intervals.length ? round(Math.max(...intervals)) : null,
    missed: intervals.filter((gap) => gap > vsync * MISS_FACTOR).length,
    slowerThan60fps: intervals.filter((gap) => gap > SIXTY_FPS_MS + JITTER_MS).length,
    draws: draws.length,
    drawMeanMs: drawGaps.length
      ? round(drawGaps.reduce((sum, gap) => sum + gap, 0) / drawGaps.length)
      : null,
    drawP95Ms: p(drawGaps, 95),
    gpuP50Ms: p(gpu, 50),
    gpuP95Ms: p(gpu, 95),
  };
}

export function formatWindow(label: string, stats: WindowStats): string {
  return (
    `${label}: ${stats.frames} frames, p50 ${stats.intervalP50Ms ?? '—'} / p95 ` +
    `${stats.intervalP95Ms ?? '—'} / max ${stats.intervalMaxMs ?? '—'} ms, ` +
    `${stats.slowerThan60fps} slower than 60 fps (${stats.missed} vsyncs missed) · ` +
    `globe ${stats.draws} draws, every ${stats.drawMeanMs ?? '—'} ms · GPU p95 ${stats.gpuP95Ms ?? '—'} ms`
  );
}
