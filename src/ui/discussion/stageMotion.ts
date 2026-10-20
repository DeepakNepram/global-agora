import { easeInOutCubic, type LensShift } from '@/globe';
import type { CameraMove, StageSegment } from '@/state';

import {
  SHEET_SETTLE_SECONDS,
  SNAP_LOOKAHEAD_SECONDS,
  springAt,
  startSpring,
} from '../story/sheetSpring';

/**
 * The discussion stage's motion (Prompt 4.5) as pure functions of time:
 * where the panel is, how far the globe has receded, how the lens is
 * shifted. The panel's compositor animation is sampled from these, and the
 * globe samples them every frame, so both follow one curve from one start.
 */

/** "All one coordinated motion, 600 ms, ease-in-out cubic." */
export const STAGE_MS = 600;

/** Spring-back after a drag: the story sheet's critically damped 320 ms. */
export const SPRING_MS = SHEET_SETTLE_SECONDS * 1000;

/** Let go with the panel projected below this share of its height and the discussion closes. */
export const LEAVE_BELOW = 0.5;

/** Widths from here, and short landscape screens, put the panel on the right. */
export const SIDE_LAYOUT_MIN_WIDTH = 768;
const SHORT_LANDSCAPE_HEIGHT = 500;
const SIDE_MIN_WIDTH = 360;
const SIDE_SHARE = 0.36;
const SIDE_MAX_WIDTH = 480;
/** "Slides up over the bottom two-thirds on phone." */
export const BOTTOM_SHARE = 2 / 3;
/** Off screen, the panel sits this far past the edge, so its shadow is gone too. */
const OFFSTAGE_MARGIN_PX = 32;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** A channel's value at `nowMs`, 0 (on the globe) to 1 (in the discussion). */
export function segmentAt(segment: StageSegment, nowMs: number): number {
  if (segment.kind === 'held') return segment.value;
  if (segment.kind === 'ease') {
    const t = segment.durationMs > 0 ? (nowMs - segment.startMs) / segment.durationMs : 1;
    const e = easeInOutCubic(clamp01(t));
    return segment.from + (segment.to - segment.from) * e;
  }
  const spring = startSpring(segment.from, segment.velocity, segment.to);
  return springAt(spring, Math.max(0, nowMs - segment.startMs) / 1000).position;
}

/** Whether the segment has arrived (a held one always has). */
export function segmentDone(segment: StageSegment, nowMs: number): boolean {
  if (segment.kind === 'held') return true;
  const duration = segment.kind === 'ease' ? segment.durationMs : SPRING_MS;
  return nowMs - segment.startMs >= duration;
}

/** How far through its leg the camera is, as a share of time (the shot eases it). */
export function cameraFraction(move: CameraMove, nowMs: number): number {
  return move.durationMs > 0 ? clamp01((nowMs - move.startMs) / move.durationMs) : 1;
}

/**
 * Whether a release leaves: where the panel's velocity would carry it in a
 * moment (the sheets' look-ahead), below halfway. So a flick leaves from
 * anywhere and a slow drag leaves only past half. Velocity is in panel
 * heights per second, negative going down.
 */
export function releaseLeaves(position: number, velocity: number): boolean {
  return position + velocity * SNAP_LOOKAHEAD_SECONDS < LEAVE_BELOW;
}

export interface StageLayout {
  readonly kind: 'bottom' | 'side';
  readonly width: number;
  readonly height: number;
  /** The panel's own size, CSS pixels. */
  readonly panelWidth: number;
  readonly panelHeight: number;
}

/**
 * Bottom two-thirds on a phone; the right side on a tablet or desktop, and
 * on a phone held sideways, where two-thirds of a short screen is too little.
 */
export function stageLayout(width: number, height: number): StageLayout {
  const side =
    width >= SIDE_LAYOUT_MIN_WIDTH || (width > height && height < SHORT_LANDSCAPE_HEIGHT);
  if (side) {
    const panelWidth = Math.round(
      Math.min(SIDE_MAX_WIDTH, Math.max(SIDE_MIN_WIDTH, width * SIDE_SHARE), width),
    );
    return { kind: 'side', width, height, panelWidth, panelHeight: height };
  }
  return {
    kind: 'bottom',
    width,
    height,
    panelWidth: width,
    panelHeight: Math.round(height * BOTTOM_SHARE),
  };
}

/** The panel's transform with the stage `p` of the way in. */
export function panelTransform(p: number, layout: StageLayout): string {
  const away = 1 - p;
  return layout.kind === 'side'
    ? `translate3d(${away * (layout.panelWidth + OFFSTAGE_MARGIN_PX)}px, 0, 0)`
    : `translate3d(0, ${away * (layout.panelHeight + OFFSTAGE_MARGIN_PX)}px, 0)`;
}

/**
 * The lens shift that centres the city in what the panel leaves visible:
 * half the panel's covered size, up on a phone, left beside a side panel.
 * It follows the panel, so a peek brings the city back toward the middle.
 */
export function lensShiftFor(p: number, layout: StageLayout): LensShift {
  const covered = clamp01(p);
  return layout.kind === 'side'
    ? { width: layout.width, height: layout.height, x: (covered * layout.panelWidth) / 2, y: 0 }
    : { width: layout.width, height: layout.height, x: 0, y: (covered * layout.panelHeight) / 2 };
}

/** The panel position a finger `draggedDownPx` below where it grabbed puts it at. */
export function dragPosition(startP: number, draggedDownPx: number, layout: StageLayout): number {
  return clamp01(startP - draggedDownPx / Math.max(1, layout.panelHeight));
}

/**
 * How far the globe has receded with the panel `p` of the way in. Squared,
 * so the globe clears quickly as a finger drags the panel down to peek (half
 * way down, a quarter of the blur is left), and on entering the camera is
 * well on its way before the focus pulls off the globe.
 */
export function recedeAmount(p: number): number {
  const c = clamp01(p);
  return c * c;
}

/** The LOW tier's stand-in for the blur, which it cannot afford: a dark scrim. */
export const LOW_SCRIM_OPACITY = 0.55;

export interface SampledAnimation {
  readonly keyframes: Keyframe[];
  readonly durationMs: number;
}

/** Keyframes this far apart: the compositor's linear steps between them are invisible. */
const KEYFRAME_STEP_MS = 1000 / 60;

/**
 * A compositor animation of `segment`, sampled from the same function the
 * globe samples, for Element.animate with linear easing and its startTime
 * set to the segment's start. Null for a held segment (written directly).
 */
export function sampleAnimation(
  segment: StageSegment,
  style: (p: number) => Keyframe,
): SampledAnimation | null {
  if (segment.kind === 'held') return null;
  const durationMs = segment.kind === 'ease' ? segment.durationMs : SPRING_MS;
  if (durationMs <= 0) return null;
  const steps = Math.max(1, Math.ceil(durationMs / KEYFRAME_STEP_MS));
  const keyframes = Array.from({ length: steps + 1 }, (_, i) => ({
    ...style(segmentAt(segment, segment.startMs + (durationMs * i) / steps)),
    offset: i / steps,
  }));
  return { keyframes, durationMs };
}
