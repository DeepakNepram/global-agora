import { useState, type JSX } from 'react';

import type { QualityTier } from '@/core';
import type { OrbitGlobeControls } from '@/globe';

import { detectCapabilities } from '../platform/capabilities';
import { benchRow, postBenchReport, type BenchRow } from './benchReport';
import { DEBUG_BUTTON, PIN_COUNTS, type PinCount } from './debugControls';
import type { FrameProbe } from './frameProbe';

/** Lets a state change reach the scene and its first frames draw before measuring. */
const SETTLE_MS = 400;
const POLL_MS = 250;

interface Step {
  readonly label: string;
  readonly visible: boolean;
  readonly count: PinCount;
}

const STEPS: readonly Step[] = [
  { label: 'pins off', visible: false, count: PIN_COUNTS[0] },
  ...PIN_COUNTS.map((count) => ({ label: `${count} pins`, visible: true, count })),
];

export interface PinBenchmarkProps {
  readonly probe: FrameProbe;
  readonly tier: QualityTier;
  readonly controls: OrbitGlobeControls | null;
  readonly pinsVisible: boolean;
  readonly pinCount: PinCount;
  readonly onPinsVisibleChange: (visible: boolean) => void;
  readonly onPinCountChange: (count: PinCount) => void;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatRow(row: BenchRow): string {
  const gpu = row.gpuMeanMs === null ? 'GPU n/a' : `GPU ${row.gpuMeanMs} / ${row.gpuP95Ms} ms`;
  return `${row.label}: ${row.fps ?? '—'} fps (p95 ${row.intervalP95Ms ?? '—'} ms) · ${gpu}`;
}

/**
 * Prompt 1.5's acceptance run in one tap: the existing 300-frame benchmark with
 * pins off, then at each pin count, at the current camera pose. The pins-off
 * run is the baseline that separates the pins' cost from the rest of the frame.
 * Results are shown here and posted to the dev server, so a run on a phone
 * lands in .bench/results.jsonl on the development machine.
 */
export function PinBenchmark(props: PinBenchmarkProps): JSX.Element {
  const { probe, tier, controls, pinsVisible, pinCount } = props;
  const { onPinsVisibleChange, onPinCountChange } = props;
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<readonly BenchRow[]>([]);
  const [status, setStatus] = useState('');

  const run = async (): Promise<void> => {
    setRunning(true);
    setRows([]);
    const results: BenchRow[] = [];
    for (const step of STEPS) {
      setStatus(`Measuring ${step.label}…`);
      onPinsVisibleChange(step.visible);
      onPinCountChange(step.count);
      await wait(SETTLE_MS);
      probe.startBenchmark();
      while (probe.benchmark().running) await wait(POLL_MS);
      const { result, resultBuffer } = probe.benchmark();
      if (result) results.push(benchRow(step.label, result, resultBuffer));
      setRows([...results]);
    }
    onPinsVisibleChange(pinsVisible);
    onPinCountChange(pinCount);

    const sent = await postBenchReport({
      kind: 'pins',
      tier,
      renderer: detectCapabilities().rendererDescription,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}×${window.innerHeight}@${window.devicePixelRatio}`,
      gpuTimer: probe.gpuSupported,
      pose: controls?.getState() ?? null,
      rows: results,
    });
    setStatus(sent ? 'Done; sent to the dev server.' : 'Done; not sent (no dev server).');
    setRunning(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={DEBUG_BUTTON} disabled={running} onClick={() => void run()}>
        {running ? 'Pin benchmark running…' : 'Pin benchmark (off / 3k / 10k)'}
      </button>
      <div aria-live="polite" className="text-[11px] leading-snug text-muted">
        <p>{status}</p>
        {rows.map((row) => (
          <p key={row.label} className="tabular-nums text-ink">
            {formatRow(row)}
          </p>
        ))}
      </div>
    </div>
  );
}
