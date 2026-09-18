/**
 * Rolling frame-cost statistics.
 *
 * Pure bookkeeping: callers pass timestamps and durations in, so this has no
 * clock of its own and runs unchanged in tests. CPU and GPU samples are kept in
 * separate buffers because GPU timer queries resolve a few frames late and are
 * sometimes discarded (disjoint), so the two streams never line up one-to-one.
 */

export interface FrameSummary {
  /** CPU samples in the window. */
  readonly frames: number;
  readonly cpuMeanMs: number | null;
  readonly cpuP95Ms: number | null;
  /** GPU samples in the window; 0 where timer queries are unsupported. */
  readonly gpuFrames: number;
  readonly gpuMeanMs: number | null;
  readonly gpuP95Ms: number | null;
  /** Frames drawn in the second before `nowMs`. 0 when render-on-demand is idle. */
  readonly framesLastSecond: number;
  /**
   * Time between consecutive recorded frames. This is the frame rate the user
   * saw (fps = 1000 / mean), and the only GPU-bound measure where timer queries
   * are unavailable, as on most Android. Meaningful only while frames are drawn
   * back to back (a benchmark): with render-on-demand, idle gaps count too.
   */
  readonly intervalMeanMs: number | null;
  readonly intervalP95Ms: number | null;
}

export interface FrameStats {
  recordCpu(atMs: number, durationMs: number): void;
  recordGpu(durationMs: number): void;
  summary(nowMs: number): FrameSummary;
  reset(): void;
}

interface RingBuffer {
  push(value: number): void;
  values(): number[];
  clear(): void;
}

function createRing(capacity: number): RingBuffer {
  const data = new Float64Array(capacity);
  let next = 0;
  let size = 0;
  return {
    push(value) {
      data[next] = value;
      next = (next + 1) % capacity;
      size = Math.min(size + 1, capacity);
    },
    values() {
      return Array.from(data.subarray(0, size));
    },
    clear() {
      next = 0;
      size = 0;
    },
  };
}

/** Nearest-rank percentile, p in [0, 100]. null for no samples. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(Math.max(p, 0), 100) / 100) * sorted.length);
  return sorted[Math.max(rank, 1) - 1] ?? null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Gaps between timestamps, oldest first. The ring stores them out of order once full. */
function intervals(stamps: readonly number[]): number[] {
  const sorted = [...stamps].sort((a, b) => a - b);
  return sorted.slice(1).map((at, i) => at - (sorted[i] ?? at));
}

export function createFrameStats(capacity = 120): FrameStats {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
  }
  const cpu = createRing(capacity);
  const gpu = createRing(capacity);
  const stamps = createRing(capacity);

  return {
    recordCpu(atMs, durationMs) {
      cpu.push(durationMs);
      stamps.push(atMs);
    },
    recordGpu(durationMs) {
      gpu.push(durationMs);
    },
    summary(nowMs) {
      const cpuValues = cpu.values();
      const gpuValues = gpu.values();
      const stampValues = stamps.values();
      const gaps = intervals(stampValues);
      return {
        frames: cpuValues.length,
        cpuMeanMs: mean(cpuValues),
        cpuP95Ms: percentile(cpuValues, 95),
        gpuFrames: gpuValues.length,
        gpuMeanMs: mean(gpuValues),
        gpuP95Ms: percentile(gpuValues, 95),
        framesLastSecond: stampValues.filter((at) => at > nowMs - 1000 && at <= nowMs).length,
        intervalMeanMs: mean(gaps),
        intervalP95Ms: percentile(gaps, 95),
      };
    },
    reset() {
      cpu.clear();
      gpu.clear();
      stamps.clear();
    },
  };
}
