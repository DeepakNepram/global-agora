import { percentile } from '@/core';

import type { FrameCapture } from './frameProbe';
import type { PresentReport } from './PinScene';

/** One bloom or collapse: from the layout landing to the last spring settling. */
export interface BloomWindow {
  readonly startMs: number;
  readonly endMs: number;
  /** Slots set moving. */
  readonly moving: number;
  /** Main-thread time to plan it and write the slots. */
  readonly planMs: number;
}

export interface BloomStats {
  readonly windows: number;
  readonly moving: number;
  readonly durationMs: number | null;
  readonly frames: number;
  /** Time from each frame to the one before it: what the eye sees. */
  readonly intervalP50Ms: number | null;
  readonly intervalP95Ms: number | null;
  readonly intervalMaxMs: number | null;
  /** Frames that followed the previous one later than a 60 fps frame (16.7 ms) plus vsync jitter. */
  readonly slowerThan60fps: number;
  readonly cpuP50Ms: number | null;
  readonly cpuP95Ms: number | null;
  readonly cpuMaxMs: number | null;
  readonly gpuP50Ms: number | null;
  readonly gpuP95Ms: number | null;
  readonly gpuMaxMs: number | null;
  readonly planMaxMs: number | null;
}

const SIXTY_FPS_MS = 1000 / 60;
/**
 * A display paced at 60 Hz spaces frames 16.6–17.3 ms apart (vsync jitter);
 * only a frame later than that, a missed vsync at 60 Hz, is slower than 60 fps.
 * At 144 Hz pacing (3.1's runs) nothing comes near either line.
 */
const VSYNC_JITTER_MS = 2;
/** GPU queries resolve a few frames late; results this long after a window still belong to it. */
const GPU_LAG_MS = 60;

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function stats(values: readonly number[]): [number | null, number | null, number | null] {
  if (values.length === 0) return [null, null, null];
  return [round(percentile(values, 50)), round(percentile(values, 95)), round(Math.max(...values))];
}

/**
 * Frame timings inside each window. The first frame's interval reaches back to
 * the frame before the layout landed, so a hitch from planning the transition
 * shows up rather than hiding between windows.
 */
export function summariseBloom(
  runs: readonly { readonly window: BloomWindow; readonly capture: FrameCapture }[],
): BloomStats {
  const intervals: number[] = [];
  const cpu: number[] = [];
  const gpu: number[] = [];
  for (const { window, capture } of runs) {
    const { frames } = capture;
    frames.forEach((frame, at) => {
      if (frame.atMs < window.startMs || frame.atMs > window.endMs) return;
      cpu.push(frame.cpuMs);
      const previous = frames[at - 1];
      if (previous) intervals.push(frame.atMs - previous.atMs);
    });
    for (const sample of capture.gpu) {
      if (sample.atMs > window.startMs && sample.atMs <= window.endMs + GPU_LAG_MS)
        gpu.push(sample.ms);
    }
  }
  const [intervalP50Ms, intervalP95Ms, intervalMaxMs] = stats(intervals);
  const [cpuP50Ms, cpuP95Ms, cpuMaxMs] = stats(cpu);
  const [gpuP50Ms, gpuP95Ms, gpuMaxMs] = stats(gpu);
  const durations = runs.map(({ window }) => window.endMs - window.startMs);
  return {
    windows: runs.length,
    moving: Math.max(0, ...runs.map(({ window }) => window.moving)),
    durationMs: durations.length
      ? round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
      : null,
    frames: cpu.length,
    intervalP50Ms,
    intervalP95Ms,
    intervalMaxMs,
    slowerThan60fps: intervals.filter((interval) => interval > SIXTY_FPS_MS + VSYNC_JITTER_MS)
      .length,
    cpuP50Ms,
    cpuP95Ms,
    cpuMaxMs,
    gpuP50Ms,
    gpuP95Ms,
    gpuMaxMs,
    planMaxMs: runs.length ? round(Math.max(...runs.map(({ window }) => window.planMs))) : null,
  };
}

/** The layouts PinScene has presented, for a benchmark to wait on. */
export interface PresentLog {
  readonly count: number;
  push(report: PresentReport): void;
  /** Every report after the first `since`. */
  since(since: number): readonly PresentReport[];
  /** The first report after the first `since` that matches, or null after `timeoutMs`. */
  next(
    since: number,
    match: (report: PresentReport) => boolean,
    timeoutMs: number,
  ): Promise<PresentReport | null>;
}

const POLL_MS = 16;

export function createPresentLog(): PresentLog {
  const reports: PresentReport[] = [];
  return {
    get count() {
      return reports.length;
    },
    push(report) {
      reports.push(report);
    },
    since(since) {
      return reports.slice(since);
    },
    async next(since, match, timeoutMs) {
      for (let waited = 0; waited <= timeoutMs; waited += POLL_MS) {
        const found = reports.slice(since).find(match);
        if (found) return found;
        await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
      }
      return null;
    },
  };
}
