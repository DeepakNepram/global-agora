import { useEffect, useState, type JSX } from 'react';

import type { FrameSummary, QualityTier } from '@/core';
import type { AtmosphereMode } from '@/globe';
import { monotonicNowMs } from '@/state';

import { BENCHMARK_FRAMES, type BenchmarkState, type FrameProbe } from './frameProbe';

export interface FrameTimeOverlayProps {
  readonly probe: FrameProbe;
  readonly tier: QualityTier;
  readonly atmosphere: AtmosphereMode;
  readonly bloomEnabled: boolean;
}

/** Text refresh rate. Reading the probe never schedules a WebGL frame. */
const REFRESH_MS = 250;

function ms(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

function describe(summary: FrameSummary, gpuSupported: boolean): string {
  const gpu = gpuSupported
    ? `GPU ${ms(summary.gpuMeanMs)} / ${ms(summary.gpuP95Ms)}`
    : 'GPU n/a (no timer query)';
  return `CPU ${ms(summary.cpuMeanMs)} / ${ms(summary.cpuP95Ms)} · ${gpu}`;
}

/** Only meaningful for a benchmark, where frames are drawn back to back. */
function frameRate(summary: FrameSummary): string {
  const interval = summary.intervalMeanMs;
  if (interval === null || interval <= 0) return '';
  return ` · ${(1000 / interval).toFixed(1)} fps (p95 ${ms(summary.intervalP95Ms)} ms)`;
}

/**
 * Dev-only frame-time readout. Figures are mean / p95 milliseconds of the draw
 * call itself (CPU: command submission; GPU: timer query), over the last 120
 * rendered frames. "Drawn" is frames in the last second: 0 means
 * render-on-demand is idle, which is the goal, not a fault.
 */
export function FrameTimeOverlay({
  probe,
  tier,
  atmosphere,
  bloomEnabled,
}: FrameTimeOverlayProps): JSX.Element {
  const [summary, setSummary] = useState<FrameSummary>(() =>
    probe.rolling.summary(monotonicNowMs()),
  );
  const [benchmark, setBenchmark] = useState<BenchmarkState>(() => probe.benchmark());
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSummary(probe.rolling.summary(monotonicNowMs()));
      setBenchmark(probe.benchmark());
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [probe]);

  const config = `${tier} · ${atmosphere} · bloom ${bloomEnabled ? 'on' : 'off'}`;
  const start = (): void => {
    setLabel(config);
    probe.startBenchmark();
    setBenchmark(probe.benchmark());
  };

  return (
    <section
      aria-label="Frame time"
      className="absolute bottom-4 left-4 w-72 rounded-lg bg-void/80 p-3 font-mono text-[11px] text-ink backdrop-blur"
    >
      <p className="mb-1 uppercase tracking-wide text-muted">Frame time (mean / p95 ms)</p>
      {/* aria-live off: a 4Hz readout would drown a screen reader. */}
      <p aria-live="off">{describe(summary, probe.gpuSupported)}</p>
      <p aria-live="off" className="text-muted">
        Drawn {summary.framesLastSecond}/s · {config}
      </p>

      <button
        type="button"
        onClick={start}
        disabled={benchmark.running}
        className="mt-2 rounded bg-white/10 px-2 py-1 hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
      >
        {benchmark.running
          ? `Benchmarking… ${benchmark.remaining} left`
          : `Benchmark ${BENCHMARK_FRAMES} frames`}
      </button>

      <p aria-live="polite" className="mt-1">
        {benchmark.result && !benchmark.running
          ? `${label ?? ''} @ ${benchmark.resultBuffer ?? '?'}: ${describe(benchmark.result, probe.gpuSupported)}${frameRate(benchmark.result)}`
          : ''}
      </p>
    </section>
  );
}
