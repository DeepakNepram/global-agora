import type { PinPick, PinTarget, ScreenPoint, TargetBounds } from '@/globe';

/**
 * The bridge between the pin layer, which lives inside the canvas (PinScene),
 * and the input handling outside it: PinScene attaches functions bound to
 * r3f's camera and viewport, and the globe's taps and keys call them. The
 * flat map (Prompt 5.1) attaches its own, so keyboard focus works on both.
 */

export type PickFn = (x: number, y: number, radiusPx?: number) => PinPick | null;

export interface PinSource {
  pick: PickFn;
  /** What Tab can visit: drawn pins and orbs inside `bounds`. */
  targets(bounds?: TargetBounds): PinTarget[];
  /** Where row `row` is drawn now, or null. */
  locate(row: number): ScreenPoint | null;
  /** The view's CSS size, for camera maths. */
  viewport(): { width: number; height: number };
}

export interface PinPicker {
  /** The pin under (x, y) in canvas CSS pixels, or null (also before the layer exists). */
  pick: PickFn;
  targets(bounds?: TargetBounds): PinTarget[];
  locate(row: number): ScreenPoint | null;
  /** The canvas's CSS size, for camera maths; zero before the layer exists. */
  viewport(): { readonly width: number; readonly height: number };
  attach(source: PinSource | null): void;
}

export function createPinPicker(): PinPicker {
  let current: PinSource | null = null;
  return {
    pick: (x, y, radiusPx) => current?.pick(x, y, radiusPx) ?? null,
    targets: (bounds) => current?.targets(bounds) ?? [],
    locate: (row) => current?.locate(row) ?? null,
    viewport: () => current?.viewport() ?? { width: 0, height: 0 },
    attach(source) {
      current = source;
    },
  };
}
