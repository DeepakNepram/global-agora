import type { DiscussionStageStore, StageSegment, StageTarget } from '@/state';

import { releaseLeaves, segmentAt, SPRING_MS, STAGE_MS } from './stageMotion';

/**
 * Moves the discussion stage (Prompt 4.5): writes the segments every part of
 * it follows, and ends each on a timer, so it finishes on time whether or
 * not frames are being drawn.
 *
 * Quality: half resolution and 30 fps only while the panel is settled. Any
 * motion runs at full quality, and a leave from rest asks for it back first:
 * the resize (every buffer reallocated) is drawn before anything moves, and
 * the GPU, clocked down by seconds of light 30 fps work, has LEAVE_WARMUP_MS
 * of full-rate frames to clock back up. Without that, leaving dropped one or
 * two frames below 60 fps at its start (Prompt 4.5's benchmark).
 */

/** Full-quality frames before a leave from rest moves. */
export const LEAVE_WARMUP_MS = 100;

export interface StageClock {
  now(): number;
  /** requestAnimationFrame. */
  nextFrame(callback: (timeMs: number) => void): void;
  setTimer(callback: () => void, ms: number): number;
  clearTimer(handle: number): void;
}

export interface StageController {
  /** Shows the stage for `target`, still: begin() starts the motion on the panel's first frame. */
  open(target: StageTarget, reducedMotion: boolean): void;
  begin(nowMs: number): void;
  leave(): void;
  /** A finger took the panel: full quality, and the panel follows it. */
  dragStart(): void;
  dragTo(p: number): void;
  /** Let go at `p`, moving `velocity` panel heights per second (negative is down). */
  dragEnd(p: number, velocity: number): void;
  dispose(): void;
}

const held = (value: number): StageSegment => ({ kind: 'held', value });

export function createStageController(
  store: DiscussionStageStore,
  clock: StageClock,
): StageController {
  let timer: number | null = null;
  let begun = false;
  let leaveQueued = false;

  const schedule = (callback: () => void, ms: number): void => {
    if (timer !== null) clock.clearTimer(timer);
    timer = clock.setTimer(() => {
      timer = null;
      callback();
    }, ms);
  };
  const cancel = (): void => {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
  };
  const panelNow = (): number => segmentAt(store.getState().panel, clock.now());

  const finishClosing = (): void => {
    store.setState({ phase: 'closed', panel: held(0), camera: null, orbitFromMs: null });
  };

  const startLeave = (nowMs: number): void => {
    leaveQueued = false;
    const state = store.getState();
    if (state.phase === 'closed') return;
    const from = segmentAt(state.panel, nowMs);
    if (state.reducedMotion) {
      cancel();
      finishClosing();
      return;
    }
    store.setState({
      phase: 'leaving',
      dragging: false,
      quality: 'full',
      panel: { kind: 'ease', from, to: 0, startMs: nowMs, durationMs: STAGE_MS },
      camera: { direction: 'out', startMs: nowMs, durationMs: STAGE_MS },
    });
    schedule(finishClosing, STAGE_MS);
  };

  return {
    open(target, reducedMotion) {
      if (store.getState().phase !== 'closed') return;
      cancel();
      begun = false;
      leaveQueued = false;
      store.setState({
        phase: 'entering',
        target,
        panel: held(0),
        camera: null,
        orbitFromMs: null,
        dragging: false,
        quality: 'full',
        reducedMotion,
      });
    },

    begin(nowMs) {
      const state = store.getState();
      if (state.phase !== 'entering' || begun) return;
      begun = true;
      if (state.reducedMotion) {
        store.setState({ phase: 'open', panel: held(1), quality: 'rest' });
        return;
      }
      store.setState({
        panel: { kind: 'ease', from: 0, to: 1, startMs: nowMs, durationMs: STAGE_MS },
        camera: { direction: 'in', startMs: nowMs, durationMs: STAGE_MS },
      });
      schedule(() => {
        store.setState({
          phase: 'open',
          panel: held(1),
          camera: null,
          orbitFromMs: nowMs + STAGE_MS,
          quality: 'rest',
        });
      }, STAGE_MS);
    },

    leave() {
      const state = store.getState();
      if (state.phase === 'closed' || state.phase === 'leaving' || leaveQueued) return;
      if (state.phase === 'entering' && !begun) {
        cancel();
        finishClosing();
        return;
      }
      if (state.quality === 'rest') {
        leaveQueued = true;
        cancel();
        store.setState({ quality: 'full' });
        // The resized frame draws first; the motion starts on the first frame
        // after the warm-up, and never before the second.
        const asked = clock.now();
        const whenWarm = (timeMs: number): void => {
          if (timeMs - asked >= LEAVE_WARMUP_MS) startLeave(timeMs);
          else clock.nextFrame(whenWarm);
        };
        clock.nextFrame(() => clock.nextFrame(whenWarm));
        return;
      }
      startLeave(clock.now());
    },

    dragStart() {
      const state = store.getState();
      if (state.phase !== 'open' || state.dragging) return;
      cancel();
      store.setState({ dragging: true, quality: 'full', panel: held(panelNow()) });
    },

    dragTo(p) {
      if (!store.getState().dragging) return;
      store.setState({ panel: held(Math.min(1, Math.max(0, p))) });
    },

    dragEnd(p, velocity) {
      const state = store.getState();
      if (!state.dragging) return;
      const position = Math.min(1, Math.max(0, p));
      if (releaseLeaves(position, velocity)) {
        store.setState({ panel: held(position) });
        startLeave(clock.now());
        return;
      }
      const startMs = clock.now();
      store.setState({
        dragging: false,
        panel: { kind: 'spring', from: position, to: 1, velocity, startMs },
      });
      schedule(() => store.setState({ panel: held(1), quality: 'rest' }), SPRING_MS);
    },

    dispose() {
      cancel();
    },
  };
}
