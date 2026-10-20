import { describe, expect, it } from 'vitest';

import { easeInOutCubic } from '@/globe';
import type { StageSegment } from '@/state';

import {
  cameraFraction,
  dragPosition,
  lensShiftFor,
  panelTransform,
  recedeAmount,
  releaseLeaves,
  sampleAnimation,
  segmentAt,
  segmentDone,
  stageLayout,
  SPRING_MS,
  STAGE_MS,
} from './stageMotion';

const enter: StageSegment = { kind: 'ease', from: 0, to: 1, startMs: 1000, durationMs: STAGE_MS };

describe('segmentAt', () => {
  it('eases in and out over 600 ms from its start', () => {
    expect(segmentAt(enter, 1000)).toBe(0);
    expect(segmentAt(enter, 900)).toBe(0);
    expect(segmentAt(enter, 1300)).toBeCloseTo(0.5, 12);
    expect(segmentAt(enter, 1000 + STAGE_MS * 0.25)).toBeCloseTo(easeInOutCubic(0.25), 12);
    expect(segmentAt(enter, 1600)).toBe(1);
    expect(segmentDone(enter, 1599)).toBe(false);
    expect(segmentDone(enter, 1600)).toBe(true);
  });

  it('reverses from wherever it was, with no jump', () => {
    const at = 1000 + 240;
    const leave: StageSegment = {
      kind: 'ease',
      from: segmentAt(enter, at),
      to: 0,
      startMs: at,
      durationMs: STAGE_MS,
    };
    expect(segmentAt(leave, at)).toBe(segmentAt(enter, at));
    expect(segmentAt(leave, at + STAGE_MS)).toBe(0);
  });

  it('springs back to 1 within 320 ms without passing it', () => {
    const spring: StageSegment = { kind: 'spring', from: 0.6, to: 1, velocity: 5, startMs: 0 };
    for (let t = 0; t <= SPRING_MS; t += 4) expect(segmentAt(spring, t)).toBeLessThanOrEqual(1);
    expect(segmentAt(spring, 0)).toBeCloseTo(0.6, 12);
    expect(segmentAt(spring, SPRING_MS)).toBe(1);
    expect(segmentDone(spring, SPRING_MS)).toBe(true);
  });

  it('holds a dragged value', () => {
    expect(segmentAt({ kind: 'held', value: 0.42 }, 123)).toBe(0.42);
  });
});

describe('cameraFraction', () => {
  it('is the share of time gone, clamped', () => {
    const move = { direction: 'in' as const, startMs: 100, durationMs: 600 };
    expect(cameraFraction(move, 0)).toBe(0);
    expect(cameraFraction(move, 400)).toBe(0.5);
    expect(cameraFraction(move, 9000)).toBe(1);
  });
});

describe('releaseLeaves', () => {
  it('leaves past halfway, or on a flick down from anywhere', () => {
    expect(releaseLeaves(0.45, 0)).toBe(true);
    expect(releaseLeaves(0.55, 0)).toBe(false);
    expect(releaseLeaves(0.9, -4)).toBe(true);
    expect(releaseLeaves(0.4, 3)).toBe(false);
  });
});

describe('stageLayout', () => {
  it('uses the bottom two-thirds on a phone held upright', () => {
    expect(stageLayout(390, 780)).toMatchObject({
      kind: 'bottom',
      panelWidth: 390,
      panelHeight: 520,
    });
  });

  it('uses the right side on a tablet, a desktop and a phone held sideways', () => {
    expect(stageLayout(768, 1024)).toMatchObject({
      kind: 'side',
      panelWidth: 360,
      panelHeight: 1024,
    });
    expect(stageLayout(1440, 900)).toMatchObject({ kind: 'side', panelWidth: 480 });
    expect(stageLayout(1100, 800).panelWidth).toBe(396);
    expect(stageLayout(780, 360).kind).toBe('side');
  });
});

describe('panel geometry', () => {
  const phone = stageLayout(390, 780);
  const desktop = stageLayout(1440, 900);

  it('slides the panel in from the bottom or the right', () => {
    expect(panelTransform(1, phone)).toBe('translate3d(0, 0px, 0)');
    expect(panelTransform(0, phone)).toBe('translate3d(0, 552px, 0)');
    expect(panelTransform(0, desktop)).toBe('translate3d(512px, 0, 0)');
  });

  it('shifts the lens so the city sits in the middle of what is left', () => {
    // Phone: the top third is left; its middle is a third of the height above centre.
    expect(lensShiftFor(1, phone)).toEqual({ width: 390, height: 780, x: 0, y: 260 });
    expect(lensShiftFor(1, desktop)).toEqual({ width: 1440, height: 900, x: 240, y: 0 });
    expect(lensShiftFor(0.5, phone).y).toBe(130);
  });

  it('follows a finger dragging the panel down', () => {
    expect(dragPosition(1, 0, phone)).toBe(1);
    expect(dragPosition(1, 260, phone)).toBe(0.5);
    expect(dragPosition(1, -40, phone)).toBe(1);
    expect(dragPosition(1, 2000, phone)).toBe(0);
  });
});

describe('sampleAnimation', () => {
  it('samples the very curve the globe follows, from 0 to 1', () => {
    const sampled = sampleAnimation(enter, (p) => ({ opacity: p }));
    if (!sampled) throw new Error('expected an animation');
    expect(sampled.durationMs).toBe(STAGE_MS);
    expect(sampled.keyframes[0]).toEqual({ opacity: 0, offset: 0 });
    expect(sampled.keyframes.at(-1)).toEqual({ opacity: 1, offset: 1 });
    for (const frame of sampled.keyframes) {
      const offset = frame.offset ?? 0;
      expect(frame['opacity']).toBeCloseTo(segmentAt(enter, 1000 + offset * STAGE_MS), 12);
    }
    // At least one keyframe per 60 Hz frame.
    expect(sampled.keyframes.length).toBeGreaterThanOrEqual(STAGE_MS / (1000 / 60));
  });

  it('has nothing to animate while held', () => {
    expect(sampleAnimation({ kind: 'held', value: 1 }, (p) => ({ opacity: p }))).toBeNull();
  });
});

describe('recedeAmount', () => {
  it('clears the globe quickly as the panel comes down', () => {
    expect(recedeAmount(1)).toBe(1);
    expect(recedeAmount(0.5)).toBe(0.25);
    expect(recedeAmount(0)).toBe(0);
    expect(recedeAmount(2)).toBe(1);
  });
});
