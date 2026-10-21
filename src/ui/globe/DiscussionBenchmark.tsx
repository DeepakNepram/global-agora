import { useState, type JSX } from 'react';

import type { QualityTier } from '@/core';
import type { OrbitGlobeControls } from '@/globe';
import { discussionStageStore, monotonicNowMs, type StagePhase } from '@/state';
// Static, not import(): this whole panel is compiled out of production
// builds, and a dynamic import here made the bundler split the app's start
// into four files, even though nothing in production ever loads it.
import { FIXTURE_STORY_ID } from '@/core/discussion.fixture';
import { createFakeRoom, type FakeRoom } from '@/state/discussionRoom.fake';

import { enterDiscussion } from '../discussion/enterDiscussion';
import { standInDiscussion } from '../discussion/room';
import { discussionStage } from '../discussion/stage';
import { detectCapabilities } from '../platform/capabilities';
import { postBenchReport } from './benchReport';
import { DEBUG_BUTTON, type PinSource } from './debugControls';
import { formatWindow, vsyncMs, windowStats, type WindowStats } from './discussionBenchReport';
import type { FrameProbe } from './frameProbe';

export interface DiscussionBenchmarkProps {
  readonly probe: FrameProbe;
  readonly tier: QualityTier;
  readonly controls: OrbitGlobeControls | null;
  readonly fullMotion: boolean;
  readonly onFullMotionChange: (fullMotion: boolean) => void;
  readonly pinSource: PinSource;
  readonly onPinSourceChange: (source: PinSource) => void;
  readonly onRunningChange: (running: boolean) => void;
}

/** The pins drawn behind the panel: Prompt 3.2's acceptance load. */
const STORIES = 3000;

/** Long enough at rest to see the 30 fps cap settle, scroll both ways and take three live posts. */
const REST_MS = 5000;
const BENGALURU = { lat: 12.97, lon: 77.59 };

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

async function until(phase: StagePhase, timeoutMs = 5000): Promise<number> {
  const start = monotonicNowMs();
  while (discussionStageStore.getState().phase !== phase) {
    if (monotonicNowMs() - start > timeoutMs) throw new Error(`the stage never reached ${phase}`);
    await wait(8);
  }
  return monotonicNowMs();
}

function panelScroller(): HTMLElement | null {
  return document.querySelector('[role="dialog"][aria-modal="true"]:not([inert]) .overflow-y-auto');
}

/** Puts a live post at the very top while the panel is scrolled; returns how far the read post moved. */
async function liveInsert(fake: FakeRoom, n: number): Promise<number> {
  const scroller = panelScroller();
  if (!scroller) return Number.NaN;
  const box = scroller.getBoundingClientRect();
  const anchor = [...scroller.querySelectorAll<HTMLElement>('[data-post-id]')].find(
    (item) => item.getBoundingClientRect().top >= box.top,
  );
  const before = anchor?.getBoundingClientRect().top ?? 0;
  const base = fake.posts[0];
  if (!base) return Number.NaN;
  const id = `bench-live-${n}`;
  fake.posts.push({
    ...base,
    id,
    authorId: `bench-${n}`,
    rankScore: 99 + n,
    body: `Live post ${n}.`,
  });
  fake.feeds[0]?.onPost(id);
  await wait(250);
  return anchor ? Math.abs(anchor.getBoundingClientRect().top - before) : Number.NaN;
}

/**
 * Prompt 4.5's acceptance run, on a fixture discussion so it runs anywhere
 * (the phone included, with no stack): enter, rest 5 s while the panel
 * scrolls down and back and three live posts arrive above the reader, then
 * leave. Every animation frame and every globe draw is kept and split into
 * windows: entering, the switch to half resolution, rest, the switch back,
 * leaving. Posted to the dev server (.bench/results.jsonl).
 */
export function DiscussionBenchmark(props: DiscussionBenchmarkProps): JSX.Element {
  const { probe, tier, controls, fullMotion, onFullMotionChange, onRunningChange } = props;
  const { pinSource, onPinSourceChange } = props;
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<readonly string[]>([]);

  const run = async (): Promise<void> => {
    if (!controls || running) return;
    setRunning(true);
    onRunningChange(true);
    setLines([]);
    const saved = controls.getState();
    const ticks: number[] = [];
    let ticking = true;
    const tick = (): void => {
      ticks.push(monotonicNowMs());
      if (ticking) window.requestAnimationFrame(tick);
    };
    let failure: string | null = null;
    let report: Record<string, unknown> = {};
    try {
      const fake = createFakeRoom(60);
      fake.readerId = 'bench-reader';
      standInDiscussion(async () => fake.remotes);
      onFullMotionChange(true);
      onPinSourceChange(STORIES);
      controls.setState({ lat: 18, lon: 70, altitudeKm: controls.getLimits().fitKm });
      await wait(1500);
      window.requestAnimationFrame(tick);
      await wait(700);
      const vsync = vsyncMs(ticks);
      probe.startCapture();
      const entered = controls.getState();

      await enterDiscussion({
        storySeq: 0,
        storyId: FIXTURE_STORY_ID,
        city: BENGALURU,
        controls,
        reducedMotion: false,
      });
      while (discussionStageStore.getState().camera === null) await wait(4);
      const enterStart = discussionStageStore.getState().camera?.startMs ?? monotonicNowMs();
      const openAt = await until('open');

      await wait(800);
      panelScroller()?.scrollBy({ top: 1500, behavior: 'smooth' });
      await wait(900);
      const drifts = [
        await liveInsert(fake, 1),
        await liveInsert(fake, 2),
        await liveInsert(fake, 3),
      ];
      await wait(400);
      panelScroller()?.scrollBy({ top: -1500, behavior: 'smooth' });
      await wait(REST_MS - 800 - 900 - 3 * 250 - 400);

      const leaveAsked = monotonicNowMs();
      discussionStage.leave();
      await until('leaving');
      const leaveStart = discussionStageStore.getState().camera?.startMs ?? monotonicNowMs();
      const closedAt = await until('closed');
      await wait(300);
      const capture = probe.stopCapture();
      ticking = false;

      const after = controls.getState();
      const stats = (from: number, to: number): WindowStats =>
        windowStats(ticks, capture, from, to, vsync);
      const windows = {
        enter: stats(enterStart, openAt),
        toRest: stats(openAt, openAt + 250),
        rest: stats(openAt + 250, leaveAsked),
        toFull: stats(leaveAsked, leaveStart),
        leave: stats(leaveStart, closedAt),
      };
      report = {
        vsyncMs: Math.round(vsync * 100) / 100,
        ...windows,
        anchorDriftPx: drifts.map((drift) => Math.round(drift * 100) / 100),
        // The pose saved on entering, given back exactly: 0 when it is.
        restoreError: Math.max(
          Math.abs(after.lat - entered.lat),
          Math.abs(after.lon - entered.lon),
          Math.abs(after.altitudeKm - entered.altitudeKm),
        ),
      };
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      probe.stopCapture();
    } finally {
      ticking = false;
      if (discussionStageStore.getState().phase !== 'closed') discussionStage.leave();
      standInDiscussion(null);
      controls.setState(saved);
      onPinSourceChange(pinSource);
      onFullMotionChange(fullMotion);
      onRunningChange(false);
    }

    const sent = await postBenchReport({
      kind: 'discussion',
      tier,
      stories: STORIES,
      renderer: detectCapabilities().rendererDescription,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
      gpuTimer: probe.gpuSupported,
      failure,
      ...report,
    });
    const shown = (key: string): string =>
      report[key] ? formatWindow(key, report[key] as WindowStats) : `${key}: —`;
    setLines([
      failure ? `Stopped: ${failure}.` : `vsync ${String(report['vsyncMs'])} ms`,
      shown('enter'),
      shown('rest'),
      shown('leave'),
      `switches: to rest max ${(report['toRest'] as WindowStats | undefined)?.intervalMaxMs ?? '—'} ms, back max ${(report['toFull'] as WindowStats | undefined)?.intervalMaxMs ?? '—'} ms`,
      `anchor drift ${JSON.stringify(report['anchorDriftPx'] ?? [])} px · restore error ${String(report['restoreError'] ?? '—')}`,
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
        {running ? 'Discussion benchmark running…' : 'Discussion benchmark (60 posts)'}
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
