import { useState, type JSX } from 'react';

import { PETAL_LEVEL, type QualityTier } from '@/core';
import { altitudeKmForZoom, type OrbitGlobeControls } from '@/globe';

import { detectCapabilities } from '../platform/capabilities';
import { postBenchReport } from './benchReport';
import { summariseBloom, type BloomStats, type BloomWindow, type PresentLog } from './bloomReport';
import { DEBUG_BUTTON, STACK_LOAD, type PinSource } from './debugControls';
import type { FrameCapture, FrameProbe } from './frameProbe';

const CYCLES = 5;
/** Zoom just above and below the petal level's threshold, clear of the hysteresis band. */
const ORB_ZOOM = PETAL_LEVEL - 0.5;
const PETAL_ZOOM = PETAL_LEVEL + 0.5;
/** Time for a new source to load, cluster and land before the first cycle. */
const SETTLE_MS = 1200;
/** Frames drawn after the last spring settles still count, so late GPU results land. */
const DRAIN_MS = 120;
const LAYOUT_TIMEOUT_MS = 3000;

export interface BloomBenchmarkProps {
  readonly probe: FrameProbe;
  readonly log: PresentLog;
  readonly tier: QualityTier;
  readonly controls: OrbitGlobeControls | null;
  readonly pinSource: PinSource;
  readonly clustering: boolean;
  readonly fullMotion: boolean;
  readonly onPinSourceChange: (source: PinSource) => void;
  readonly onClusteringChange: (clustering: boolean) => void;
  readonly onFullMotionChange: (fullMotion: boolean) => void;
  readonly onRunningChange: (running: boolean) => void;
}

type Direction = 'bloom' | 'collapse';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatStats(label: string, stats: BloomStats): string {
  return (
    `${label} (${stats.moving} moving, ${stats.durationMs ?? '—'} ms, ${stats.frames} frames): ` +
    `interval p50 ${stats.intervalP50Ms ?? '—'} / p95 ${stats.intervalP95Ms ?? '—'} / max ` +
    `${stats.intervalMaxMs ?? '—'} ms, ${stats.slowerThan60fps} slower than 60 fps · ` +
    `CPU p95 ${stats.cpuP95Ms ?? '—'} ms · GPU p95 ${stats.gpuP95Ms ?? '—'} ms · ` +
    `plan max ${stats.planMaxMs ?? '—'} ms`
  );
}

/**
 * Prompt 3.1's acceptance run: a 120-story stack (STACK_LOAD) blooms into its
 * sunflower and collapses back five times, with every frame of each animation
 * captured: interval, CPU and GPU time. Full motion is forced for the run, and
 * the camera jumps straight across the petal level's threshold so the frames
 * measured are the bloom's own, not a camera flight's. Results are posted to
 * the dev server (.bench/results.jsonl), as the pin benchmark's are.
 */
export function BloomBenchmark(props: BloomBenchmarkProps): JSX.Element {
  const { probe, log, tier, controls, pinSource, clustering, fullMotion } = props;
  const { onPinSourceChange, onClusteringChange, onFullMotionChange, onRunningChange } = props;
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<readonly string[]>([]);

  const run = async (): Promise<void> => {
    if (!controls) return;
    setRunning(true);
    onRunningChange(true);
    setLines([]);
    const pose = controls.getState();
    const height = document.querySelector('canvas')?.clientHeight ?? window.innerHeight;
    const over = (zoom: number): Parameters<OrbitGlobeControls['setState']>[0] => ({
      lat: STACK_LOAD.stack.lat,
      lon: STACK_LOAD.stack.lon,
      altitudeKm: altitudeKmForZoom(zoom, height),
    });
    const runs: Record<Direction, { window: BloomWindow; capture: FrameCapture }[]> = {
      bloom: [],
      collapse: [],
    };
    let failure: string | null = null;

    try {
      onPinSourceChange('stack');
      onClusteringChange(true);
      onFullMotionChange(true);
      controls.setState(over(ORB_ZOOM));
      await wait(SETTLE_MS);

      for (let cycle = 0; cycle < CYCLES; cycle++) {
        const steps: [Direction, number, number][] = [
          ['bloom', PETAL_ZOOM, PETAL_LEVEL],
          ['collapse', ORB_ZOOM, PETAL_LEVEL - 1],
        ];
        for (const [direction, zoom, level] of steps) {
          const since = log.count;
          probe.startCapture();
          controls.setState(over(zoom));
          const report = await log.next(since, (r) => r.level === level, LAYOUT_TIMEOUT_MS);
          if (!report) {
            probe.stopCapture();
            throw new Error(`no ${direction} layout arrived`);
          }
          await wait(report.durationMs + DRAIN_MS);
          const { atMs, durationMs, moving, planMs } = report;
          runs[direction].push({
            window: { startMs: atMs, endMs: atMs + durationMs, moving, planMs },
            capture: probe.stopCapture(),
          });
          await wait(250);
        }
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      controls.setState(pose);
      onPinSourceChange(pinSource);
      onClusteringChange(clustering);
      onFullMotionChange(fullMotion);
      onRunningChange(false);
    }

    const bloom = summariseBloom(runs.bloom);
    const collapse = summariseBloom(runs.collapse);
    const sent = await postBenchReport({
      kind: 'bloom',
      tier,
      renderer: detectCapabilities().rendererDescription,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
      gpuTimer: probe.gpuSupported,
      failure,
      bloom,
      collapse,
    });
    setLines([
      failure ? `Stopped: ${failure}.` : `${CYCLES} cycles.`,
      formatStats('Bloom', bloom),
      formatStats('Collapse', collapse),
      sent ? 'Sent to the dev server.' : 'Not sent (no dev server).',
    ]);
    setRunning(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className={DEBUG_BUTTON}
        disabled={running || !controls}
        onClick={() => void run()}
      >
        {running ? 'Bloom benchmark running…' : `Bloom benchmark (${STACK_LOAD.stack.count} stack)`}
      </button>
      <div aria-live="polite" className="text-[11px] leading-snug text-muted">
        {lines.map((line) => (
          <p key={line} className="tabular-nums">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
