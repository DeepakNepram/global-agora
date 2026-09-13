import { createFrameStats, type FrameStats, type FrameSummary } from '@/core';

/** Frames measured per benchmark run. */
export const BENCHMARK_FRAMES = 300;

/**
 * Frames drawn but not recorded at the start of a run: absorbs a shader compile
 * after a render toggle and GPU queries still in flight from before the run.
 */
export const BENCHMARK_WARMUP_FRAMES = 30;

/** Frames allowed after the measured ones for late GPU query results. */
const GPU_DRAIN_FRAMES = 60;

export interface BenchmarkState {
  readonly running: boolean;
  /** Measured frames still to draw. */
  readonly remaining: number;
  readonly result: FrameSummary | null;
  /** Drawing-buffer size the result was measured at, e.g. "1300×838". */
  readonly resultBuffer: string | null;
}

export interface FrameProbe {
  readonly rolling: FrameStats;
  readonly gpuSupported: boolean;
  benchmark(): BenchmarkState;
  startBenchmark(): void;
  /** Registers the render loop's kick; returns the unsubscribe. */
  onBenchmarkStart(listener: () => void): () => void;

  // Render-loop side.
  setGpuSupported(supported: boolean): void;
  setBufferSize(width: number, height: number): void;
  /** Returns true while the benchmark needs another frame. */
  recordFrame(atMs: number, cpuMs: number): boolean;
  recordGpu(ms: number): void;
}

/**
 * Shared between the render loop inside <Canvas> and the overlay outside it.
 * Plain mutable object, not a store: it changes every frame, and pushing that
 * through React would re-render on every draw and distort what it measures.
 */
export function createFrameProbe(): FrameProbe {
  const rolling = createFrameStats(120);
  const run = createFrameStats(BENCHMARK_FRAMES);
  const listeners = new Set<() => void>();

  let gpuSupported = false;
  let buffer = '';
  let drawn = 0;
  let running = false;
  let result: FrameSummary | null = null;
  let resultBuffer: string | null = null;

  const measured = (): number => Math.max(0, drawn - BENCHMARK_WARMUP_FRAMES);

  return {
    rolling,
    get gpuSupported() {
      return gpuSupported;
    },

    benchmark() {
      return {
        running,
        remaining: running ? Math.max(0, BENCHMARK_FRAMES - measured()) : 0,
        result,
        resultBuffer,
      };
    },

    startBenchmark() {
      if (running) return;
      run.reset();
      drawn = 0;
      running = true;
      for (const listener of listeners) listener();
    },

    onBenchmarkStart(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setGpuSupported(supported) {
      gpuSupported = supported;
    },

    setBufferSize(width, height) {
      buffer = `${width}×${height}`;
    },

    recordFrame(atMs, cpuMs) {
      rolling.recordCpu(atMs, cpuMs);
      if (!running) return false;

      drawn += 1;
      const inRun = measured();
      if (inRun >= 1 && inRun <= BENCHMARK_FRAMES) run.recordCpu(atMs, cpuMs);

      const summary = run.summary(atMs);
      const gpuDone = !gpuSupported || summary.gpuFrames >= BENCHMARK_FRAMES;
      const drained = inRun >= BENCHMARK_FRAMES + GPU_DRAIN_FRAMES;
      if (inRun >= BENCHMARK_FRAMES && (gpuDone || drained)) {
        running = false;
        result = summary;
        resultBuffer = buffer;
        return false;
      }
      return true;
    },

    recordGpu(ms) {
      rolling.recordGpu(ms);
      // Results lag by a few frames, so warm-up frames resolve inside the
      // warm-up window and are dropped here with it.
      if (running && measured() >= 1) run.recordGpu(ms);
    },
  };
}
