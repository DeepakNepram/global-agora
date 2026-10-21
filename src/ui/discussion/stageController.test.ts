import { describe, expect, it } from 'vitest';

import { createDiscussionStageStore, type StageTarget } from '@/state';

import { createStageController, LEAVE_WARMUP_MS, type StageClock } from './stageController';
import { segmentAt, SPRING_MS, STAGE_MS } from './stageMotion';

const TARGET: StageTarget = {
  storySeq: 7,
  storyId: '00000000-0000-4000-8000-000000000007',
  city: { lat: 12.97, lon: 77.59 },
  savedPose: { lat: 20, lon: 10, altitudeKm: 19_000 },
  returnSheet: 'peek',
};

/** A hand-wound clock: time moves only when the test says, frames only when it asks. */
function fakeClock(): StageClock & {
  advance(ms: number): void;
  frame(): void;
  readonly time: number;
} {
  let time = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let frames: ((t: number) => void)[] = [];
  return {
    get time() {
      return time;
    },
    now: () => time,
    nextFrame: (callback) => frames.push(callback),
    setTimer(callback, ms) {
      const id = nextId++;
      timers.set(id, { at: time + ms, callback });
      return id;
    },
    clearTimer: (id) => void timers.delete(id),
    advance(ms) {
      time += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= time) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    frame() {
      time += 16;
      const due = frames;
      frames = [];
      for (const callback of due) callback(time);
    },
  };
}

function setup(reducedMotion = false) {
  const store = createDiscussionStageStore();
  const clock = fakeClock();
  const stage = createStageController(store, clock);
  stage.open(TARGET, reducedMotion);
  return { store, clock, stage, p: () => segmentAt(store.getState().panel, clock.time) };
}

describe('entering', () => {
  it('waits, still, for the panel’s first frame, then moves everything together for 600 ms', () => {
    const { store, clock, stage, p } = setup();
    expect(store.getState()).toMatchObject({ phase: 'entering', quality: 'full', camera: null });
    clock.advance(50);
    expect(p()).toBe(0);
    stage.begin(clock.time);
    expect(store.getState().camera).toEqual({ direction: 'in', startMs: 50, durationMs: STAGE_MS });
    clock.advance(STAGE_MS / 2);
    expect(p()).toBeCloseTo(0.5, 12);
    expect(store.getState().phase).toBe('entering');
    clock.advance(STAGE_MS / 2);
    expect(store.getState()).toMatchObject({
      phase: 'open',
      quality: 'rest',
      camera: null,
      orbitFromMs: 50 + STAGE_MS,
    });
    expect(p()).toBe(1);
  });

  it('under reduced motion, simply appears', () => {
    const { store, clock, stage, p } = setup(true);
    stage.begin(clock.time);
    expect(store.getState()).toMatchObject({ phase: 'open', quality: 'rest', camera: null });
    expect(p()).toBe(1);
  });
});

describe('leaving', () => {
  it('from rest, asks for full quality first and moves once the GPU has warmed up', () => {
    const { store, clock, stage, p } = setup();
    stage.begin(0);
    clock.advance(STAGE_MS);
    const asked = clock.time;
    stage.leave();
    expect(store.getState()).toMatchObject({ phase: 'open', quality: 'full' });
    stage.leave();
    while (store.getState().phase === 'open') clock.frame();
    const started = store.getState().camera?.startMs ?? 0;
    expect(started - asked).toBeGreaterThanOrEqual(LEAVE_WARMUP_MS);
    expect(started - asked).toBeLessThan(LEAVE_WARMUP_MS + 32);
    expect(store.getState()).toMatchObject({ phase: 'leaving', camera: { direction: 'out' } });
    expect(p()).toBe(1);
    clock.advance(STAGE_MS);
    expect(store.getState()).toMatchObject({ phase: 'closed', target: TARGET });
    expect(p()).toBe(0);
  });

  it('mid-entrance, reverses at once from where the panel is', () => {
    const { store, clock, stage, p } = setup();
    stage.begin(0);
    clock.advance(200);
    const at = p();
    stage.leave();
    expect(store.getState().phase).toBe('leaving');
    expect(p()).toBeCloseTo(at, 12);
    clock.advance(STAGE_MS);
    expect(store.getState().phase).toBe('closed');
  });

  it('before it began, just closes', () => {
    const { store, stage } = setup();
    stage.leave();
    expect(store.getState().phase).toBe('closed');
  });
});

describe('dragging the panel', () => {
  function opened() {
    const context = setup();
    context.stage.begin(0);
    context.clock.advance(STAGE_MS);
    return context;
  }

  it('restores full quality and follows the finger', () => {
    const { store, stage, p } = opened();
    stage.dragStart();
    expect(store.getState()).toMatchObject({ dragging: true, quality: 'full' });
    stage.dragTo(0.7);
    expect(p()).toBe(0.7);
  });

  it('springs back from part way, then rests again at half quality', () => {
    const { store, clock, stage, p } = opened();
    stage.dragStart();
    stage.dragTo(0.7);
    stage.dragEnd(0.7, 0);
    expect(store.getState()).toMatchObject({ phase: 'open', dragging: false, quality: 'full' });
    clock.advance(SPRING_MS);
    expect(p()).toBe(1);
    expect(store.getState().quality).toBe('rest');
  });

  it('leaves past halfway, from where it was let go', () => {
    const { store, clock, stage, p } = opened();
    stage.dragStart();
    stage.dragEnd(0.3, 0);
    expect(store.getState().phase).toBe('leaving');
    expect(p()).toBeCloseTo(0.3, 12);
    clock.advance(STAGE_MS);
    expect(store.getState().phase).toBe('closed');
  });

  it('leaves on a flick down', () => {
    const { store, stage } = opened();
    stage.dragStart();
    stage.dragEnd(0.85, -5);
    expect(store.getState().phase).toBe('leaving');
  });
});
