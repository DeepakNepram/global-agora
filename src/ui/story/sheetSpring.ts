import type { SheetState } from '@/state';

/**
 * The story sheet's motion: a critically damped spring that settles in the
 * prompt's 320 ms, its stops, and where a drag lets it come to rest. Pure
 * maths in CSS pixels of translateY (0 is the sheet fully up), so it tests
 * without a DOM.
 */

/** The full sheet's height: the prompt's 90 % of the globe's area. */
export const SHEET_FULL_FRACTION = 0.9;

/** The peek card shows this much of the area: the prompt's third of the screen... */
export const SHEET_PEEK_FRACTION = 1 / 3;

/** ...but never less than its content needs, on a short landscape screen. */
export const PEEK_MIN_CSS_PX = 208;

/** Closed, the sheet sits this far below the edge, so its shadow is gone too. */
const CLOSED_MARGIN_CSS_PX = 32;

/** translateY for each state of a sheet in an area `height` CSS px tall. */
export function sheetStops(height: number): Readonly<Record<SheetState, number>> {
  const sheetHeight = SHEET_FULL_FRACTION * Math.max(0, height);
  const peekShown = Math.min(sheetHeight, Math.max(SHEET_PEEK_FRACTION * height, PEEK_MIN_CSS_PX));
  return {
    full: 0,
    peek: sheetHeight - peekShown,
    closed: sheetHeight + CLOSED_MARGIN_CSS_PX,
  };
}

/** The prompt's settle time. */
export const SHEET_SETTLE_SECONDS = 0.32;

/**
 * Critically damped from rest, the gap left after τ is (1 + ωτ)e^(−ωτ), which
 * is 0.1 % at ωτ = 9.233, so ω = 9.233 / 0.32 s ≈ 28.9 /s lands in 320 ms.
 */
export const SHEET_OMEGA = 9.233 / SHEET_SETTLE_SECONDS;

/** A drag's release velocity carries the sheet this far ahead when choosing where it rests. */
export const SNAP_LOOKAHEAD_SECONDS = 0.15;

/** Past the top stop, a drag moves the sheet this fraction of the finger: it resists. */
export const RUBBER_BAND = 0.25;

export interface SpringStart {
  /** translateY when it started, px. */
  readonly from: number;
  /** Its velocity then, px/s (positive moves the sheet down). */
  readonly velocity: number;
  readonly to: number;
}

export interface SpringSample {
  readonly position: number;
  readonly velocity: number;
  readonly done: boolean;
}

/**
 * A velocity toward the target is capped at ω·|Δ|. Beyond that, a critically
 * damped spring crosses its target once before settling, so a hard flick
 * would carry the sheet past its stop; capped, it never overshoots:
 *   x(τ) − to = (Δ + Bτ)e^(−ωτ),  B = v₀ + ωΔ,  Δ = from − to
 * changes sign only if Δ and B differ in sign, i.e. if |v₀| > ω|Δ| toward it.
 */
export function startSpring(from: number, velocity: number, to: number): SpringStart {
  const delta = from - to;
  const towards = Math.sign(velocity) === -Math.sign(delta);
  const cap = SHEET_OMEGA * Math.abs(delta);
  const v = towards ? Math.sign(velocity) * Math.min(Math.abs(velocity), cap) : velocity;
  return { from, velocity: Number.isFinite(v) ? v : 0, to };
}

/**
 * The spring τ seconds after it started, in closed form, so it is frame-rate
 * independent by construction:
 *   x = to + (Δ + Bτ)e^(−ωτ),  v = (v₀ − ωBτ)e^(−ωτ)
 * From SHEET_SETTLE_SECONDS on it is exactly at its target and done.
 */
export function springAt(spring: SpringStart, tau: number): SpringSample {
  if (tau >= SHEET_SETTLE_SECONDS) return { position: spring.to, velocity: 0, done: true };
  const t = Math.max(0, tau);
  const delta = spring.from - spring.to;
  const b = spring.velocity + SHEET_OMEGA * delta;
  const decay = Math.exp(-SHEET_OMEGA * t);
  return {
    position: spring.to + (delta + b * t) * decay,
    velocity: (spring.velocity - SHEET_OMEGA * b * t) * decay,
    done: false,
  };
}

/** Where a finger `dragged` px from `start` puts the sheet: it resists above the top stop. */
export function dragPosition(start: number, dragged: number, top: number): number {
  const raw = start + dragged;
  return raw >= top ? raw : top + (raw - top) * RUBBER_BAND;
}

/**
 * The stop a released sheet rests at: the nearest to where its velocity
 * would carry it in SNAP_LOOKAHEAD_SECONDS, so a flick goes on to the next
 * stop and a slow drag rests where it is nearest. Returns the stop's index.
 */
export function snapStop(position: number, velocity: number, stops: readonly number[]): number {
  const projected = position + velocity * SNAP_LOOKAHEAD_SECONDS;
  let best = 0;
  stops.forEach((stop, i) => {
    if (Math.abs(stop - projected) < Math.abs((stops[best] ?? Infinity) - projected)) best = i;
  });
  return best;
}
