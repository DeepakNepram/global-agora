import type { PinPick } from '@/globe';

/**
 * The bridge between the pin layer, which lives inside the canvas (PinScene),
 * and the tap handling outside it: PinScene attaches a pick function bound to
 * r3f's camera and viewport, and the globe's input calls it.
 */

export type PickFn = (x: number, y: number, radiusPx?: number) => PinPick | null;

export interface PinPicker {
  /** The pin under (x, y) in canvas CSS pixels, or null (also before the layer exists). */
  pick: PickFn;
  /** The canvas's CSS size, for camera maths; zero before the layer exists. */
  viewport(): { readonly width: number; readonly height: number };
  attach(pick: PickFn | null, viewport: (() => { width: number; height: number }) | null): void;
}

export function createPinPicker(): PinPicker {
  let current: PickFn | null = null;
  let size: (() => { width: number; height: number }) | null = null;
  return {
    pick: (x, y, radiusPx) => current?.(x, y, radiusPx) ?? null,
    viewport: () => size?.() ?? { width: 0, height: 0 },
    attach(pick, viewport) {
      current = pick;
      size = viewport;
    },
  };
}
