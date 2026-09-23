import { useState, type JSX } from 'react';

import type { QualityTier } from '@/core';
import type { OrbitGlobeControls } from '@/globe';

import { detectCapabilities } from '../platform/capabilities';
import {
  benchRow,
  pairedSchedule,
  postBenchReport,
  summarisePairs,
  type BenchRow,
  type PairedSummary,
} from './benchReport';
import { DEBUG_BUTTON, PIN_COUNTS, type PinCount } from './debugControls';
import type { FrameProbe } from './frameProbe';

/** Lets a state change reach the scene and its first frames draw before measuring. */
const SETTLE_MS = 400;
const POLL_MS = 250;
const PAIRS = 3;
/** Prompt 1.5's acceptance load. */
const PIN_LOAD: PinCount = PIN_COUNTS[0];

export interface PinBenchmarkProps {
  readonly probe: FrameProbe;
  readonly tier: QualityTier;
  readonly controls: OrbitGlobeControls | null;
  readonly pinsVisible: boolean;
  readonly pinCount: PinCount;
  readonly onPinsVisibleChange: (visible: boolean) => void;
  readonly onPinCountChange: (count: PinCount) => void;
  /** The host hides its dev overlays while a run is in progress. */
  readonly onRunningChange: (running: boolean) => void;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Android turns the screen off after ~30 s untouched, which pauses rendering
 * and records one multi-minute frame. A wake lock needs a secure context; the
 * LAN dev server is HTTPS. Returns the release, or null if none was granted.
 */
async function keepScreenOn(): Promise<(() => void) | null> {
  if (!('wakeLock' in navigator)) return null;
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    return () => void sentinel.release();
  } catch {
    return null;
  }
}

function formatRow(row: BenchRow): string {
  const side = row.pins === 0 ? 'off' : `${row.pins}`;
  const note = row.interrupted ? ' (interrupted, ignored)' : '';
  return `pair ${row.pair + 1} ${side}: ${row.fps ?? '—'} fps, p95 ${row.intervalP95Ms ?? '—'} ms${note}`;
}

function formatSummary(summary: PairedSummary): string {
  if (summary.pairs === 0) return 'No clean pairs: keep the page in front and the screen on.';
  return (
    `Median of ${summary.pairs} pairs: off ${summary.baselineFps} fps · ${PIN_LOAD} pins ` +
    `${summary.pinsFps} fps · pins cost ${summary.pinCostMs} ms/frame`
  );
}

/**
 * Prompt 1.5's acceptance run in one tap, at the current camera pose: a warm-up,
 * then three pairs of the 300-frame benchmark with pins off and with 3000 pins,
 * alternating which goes first. The paired difference is the pins' own cost,
 * separated from the rest of the frame and from a phone heating up.
 *
 * The host hides its dev overlays for the duration (their backdrop blur costs a
 * phone every frame and production has none), the screen is kept awake, and a
 * run during which the page was hidden is flagged and left out of the medians.
 * Results are posted to the dev server, so a phone's run lands in
 * .bench/results.jsonl on the development machine.
 */
export function PinBenchmark(props: PinBenchmarkProps): JSX.Element {
  const { probe, tier, controls, pinsVisible, pinCount } = props;
  const { onPinsVisibleChange, onPinCountChange, onRunningChange } = props;
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<readonly BenchRow[]>([]);
  const [status, setStatus] = useState('');

  const run = async (): Promise<void> => {
    setRunning(true);
    onRunningChange(true);
    setRows([]);
    setStatus('');
    const release = await keepScreenOn();
    // Set by the listener at any point during a run, reset before each one.
    const page = { hiddenDuringRun: false };
    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') page.hiddenDuringRun = true;
    };
    document.addEventListener('visibilitychange', onVisibility);

    const results: BenchRow[] = [];
    try {
      for (const step of pairedSchedule(PAIRS, PIN_LOAD)) {
        onPinsVisibleChange(step.pins > 0);
        onPinCountChange(PIN_LOAD);
        await wait(SETTLE_MS);
        page.hiddenDuringRun = document.visibilityState !== 'visible';
        probe.startBenchmark();
        while (probe.benchmark().running) await wait(POLL_MS);
        const { result, resultBuffer } = probe.benchmark();
        if (result && step.pair >= 0) {
          results.push(benchRow(step, result, resultBuffer, page.hiddenDuringRun));
        }
      }
    } finally {
      document.removeEventListener('visibilitychange', onVisibility);
      release?.();
      onPinsVisibleChange(pinsVisible);
      onPinCountChange(pinCount);
      onRunningChange(false);
    }

    const summary = summarisePairs(results);
    setRows(results);
    const sent = await postBenchReport({
      kind: 'pins-paired',
      tier,
      renderer: detectCapabilities().rendererDescription,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
      gpuTimer: probe.gpuSupported,
      wakeLock: release !== null,
      pose: controls?.getState() ?? null,
      summary,
      rows: results,
    });
    setStatus(
      `${formatSummary(summary)}. ${sent ? 'Sent to the dev server.' : 'Not sent (no dev server).'}`,
    );
    setRunning(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={DEBUG_BUTTON} disabled={running} onClick={() => void run()}>
        {running ? 'Pin benchmark running…' : `Pin benchmark (${PAIRS}× off vs ${PIN_LOAD})`}
      </button>
      <div aria-live="polite" className="text-[11px] leading-snug text-muted">
        <p className="text-ink">{status}</p>
        {rows.map((row) => (
          <p key={`${row.pair}-${row.pins}`} className="tabular-nums">
            {formatRow(row)}
          </p>
        ))}
      </div>
    </div>
  );
}
