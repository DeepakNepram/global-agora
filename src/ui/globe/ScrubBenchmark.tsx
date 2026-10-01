import { useState, type JSX } from 'react';

import { historyRange, timeAt, type QualityTier } from '@/core';
import type { OrbitGlobeControls } from '@/globe';
import { monotonicNowMs, timeStore, wallClockNow } from '@/state';

import { detectCapabilities } from '../platform/capabilities';
import { postBenchReport } from './benchReport';
import { summariseBloom, type BloomStats, type PresentLog } from './bloomReport';
import { DEBUG_BUTTON, type PinSource } from './debugControls';
import type { FrameProbe } from './frameProbe';

/** Prompt 3.2's acceptance load. */
const STORIES = 3000;
/** Back and forth across the whole track this many times... */
const ROUND_TRIPS = 3;
/** ...over this long: a brisk drag, fastest mid-sweep. */
const DRAG_SECONDS = 6;
/** Time for a new source to load, cluster and land before measuring. */
const SETTLE_MS = 1500;
/** Frames drawn after the last spring settles still count, so late GPU results land. */
const DRAIN_MS = 150;
const LAYOUT_TIMEOUT_MS = 3000;
/** Play is about 20 s; give up well after. */
const PLAY_TIMEOUT_MS = 40_000;

export interface ScrubBenchmarkProps {
  readonly probe: FrameProbe;
  readonly log: PresentLog;
  readonly tier: QualityTier;
  readonly controls: OrbitGlobeControls | null;
  readonly historyHours: number;
  readonly pinSource: PinSource;
  readonly clustering: boolean;
  readonly fullMotion: boolean;
  readonly onPinSourceChange: (source: PinSource) => void;
  readonly onClusteringChange: (clustering: boolean) => void;
  readonly onFullMotionChange: (fullMotion: boolean) => void;
  readonly onRunningChange: (running: boolean) => void;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Calls `step` on every animation frame for `seconds`, with the seconds elapsed. */
function animate(seconds: number, step: (elapsed: number) => void): Promise<void> {
  const start = monotonicNowMs();
  return new Promise((resolve) => {
    const frame = (): void => {
      const elapsed = (monotonicNowMs() - start) / 1000;
      step(Math.min(elapsed, seconds));
      if (elapsed >= seconds) resolve();
      else window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
  });
}

/** From now to the oldest instant and back, ROUND_TRIPS times, eased at each end like a hand. */
function sweepFraction(elapsed: number): number {
  const phase = (elapsed / DRAG_SECONDS) * ROUND_TRIPS * 2;
  const triangle = 1 - Math.abs((phase % 2) - 1);
  return 1 - 0.99 * (0.5 - 0.5 * Math.cos(Math.PI * (1 - triangle)));
}

function formatStats(label: string, stats: BloomStats): string {
  return (
    `${label} (${stats.frames} frames): interval p50 ${stats.intervalP50Ms ?? '—'} / p95 ` +
    `${stats.intervalP95Ms ?? '—'} / max ${stats.intervalMaxMs ?? '—'} ms, ` +
    `${stats.slowerThan60fps} slower than 60 fps · CPU p95 ${stats.cpuP95Ms ?? '—'} ms · ` +
    `GPU p95 ${stats.gpuP95Ms ?? '—'} ms · plan max ${stats.planMaxMs ?? '—'} ms`
  );
}

/**
 * Prompt 3.2's acceptance run: 3,000 stories at world view, clustered, in full
 * motion. A drag sweeps the whole window back and forth three times in 6 s,
 * writing the time store exactly as the pointer does (the clusters bloom open
 * on the first move and fold on release), then Play runs the whole window.
 * Every frame of each is captured, the opening bloom and closing fold
 * included, and posted to the dev server (.bench/results.jsonl).
 */
export function ScrubBenchmark(props: ScrubBenchmarkProps): JSX.Element {
  const { probe, log, tier, controls, historyHours, pinSource, clustering, fullMotion } = props;
  const { onPinSourceChange, onClusteringChange, onFullMotionChange, onRunningChange } = props;
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<readonly string[]>([]);

  /** Captures from now until the fold that follows `stop` has settled. */
  const measure = async (
    start: () => void,
    stop: () => Promise<void>,
  ): Promise<Parameters<typeof summariseBloom>[0][number]> => {
    const since = log.count;
    probe.startCapture();
    const startMs = monotonicNowMs();
    start();
    await stop();
    const restMs = monotonicNowMs();
    const fold = await log.next(since, (report) => report.atMs >= restMs, LAYOUT_TIMEOUT_MS);
    await wait((fold?.durationMs ?? 0) + DRAIN_MS);
    const presented = log.since(since);
    return {
      window: {
        startMs,
        endMs: fold ? fold.atMs + fold.durationMs : restMs,
        moving: Math.max(0, ...presented.map((report) => report.moving)),
        planMs: Math.max(0, ...presented.map((report) => report.planMs)),
      },
      capture: probe.stopCapture(),
    };
  };

  const run = async (): Promise<void> => {
    if (!controls) return;
    setRunning(true);
    onRunningChange(true);
    setLines([]);
    const pose = controls.getState();
    const time = timeStore.getState();
    let failure: string | null = null;
    let drag: Parameters<typeof summariseBloom>[0] = [];
    let play: Parameters<typeof summariseBloom>[0] = [];

    try {
      onPinSourceChange(STORIES);
      onClusteringChange(true);
      onFullMotionChange(true);
      time.goLive();
      controls.setState({ lat: 20, lon: 10, altitudeKm: controls.getLimits().fitKm });
      await wait(SETTLE_MS);

      drag = [
        await measure(
          () => time.setMotion('dragging'),
          async () => {
            await animate(DRAG_SECONDS, (elapsed) => {
              const range = historyRange(wallClockNow(), historyHours);
              time.setTime(timeAt(sweepFraction(elapsed), range));
            });
            time.setMotion('still');
          },
        ),
      ];

      time.goLive();
      await wait(SETTLE_MS);
      play = [
        await measure(
          () => time.setMotion('playing'),
          async () => {
            for (let waited = 0; timeStore.getState().motion === 'playing'; waited += 100) {
              if (waited > PLAY_TIMEOUT_MS) throw new Error('Play did not finish');
              await wait(100);
            }
          },
        ),
      ];
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      probe.stopCapture();
    } finally {
      time.setMotion('still');
      time.goLive();
      controls.setState(pose);
      onPinSourceChange(pinSource);
      onClusteringChange(clustering);
      onFullMotionChange(fullMotion);
      onRunningChange(false);
    }

    const dragStats = summariseBloom(drag);
    const playStats = summariseBloom(play);
    const sent = await postBenchReport({
      kind: 'scrub',
      tier,
      renderer: detectCapabilities().rendererDescription,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
      gpuTimer: probe.gpuSupported,
      stories: STORIES,
      failure,
      drag: dragStats,
      play: playStats,
    });
    setLines([
      failure ? `Stopped: ${failure}.` : `${STORIES} stories, world view.`,
      formatStats('Drag', dragStats),
      formatStats('Play', playStats),
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
        {running ? 'Scrub benchmark running…' : `Scrub benchmark (${STORIES.toLocaleString()})`}
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
