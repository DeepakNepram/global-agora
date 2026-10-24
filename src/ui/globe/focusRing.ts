import type { ScreenPoint } from '@/globe';

/** The keyboard's focus ring around a pin: a 44 px circle, a touch target's size. */
export const FOCUS_RING_PX = 44;

/**
 * Puts the ring around `point` (CSS pixels in the view), or hides it when the
 * pin is not drawn (turned behind the globe, folded into a cluster). Written
 * straight to the element: it follows the camera every frame, and a React
 * render per frame would cost more than the frame.
 */
export function placeRing(element: HTMLElement | null, point: ScreenPoint | null): void {
  if (!element) return;
  element.style.visibility = point ? '' : 'hidden';
  if (point) {
    const half = FOCUS_RING_PX / 2;
    element.style.transform = `translate(${point.x - half}px, ${point.y - half}px)`;
  }
}

/**
 * The part of `element` (the globe or the map) nothing covers, from the
 * elements marked data-covers="top" (search and filters) or "bottom" (the
 * scrubber, an open sheet): a pin under those is not visible, so Tab skips it.
 */
export function uncoveredBounds(element: HTMLElement): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const box = element.getBoundingClientRect();
  let top = 0;
  let bottom = box.height;
  for (const cover of document.querySelectorAll<HTMLElement>('[data-covers]')) {
    const rect = cover.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (cover.dataset['covers'] === 'top') top = Math.max(top, rect.bottom - box.top);
    else bottom = Math.min(bottom, rect.top - box.top);
  }
  return { left: 0, top, right: box.width, bottom: Math.max(top, bottom) };
}
