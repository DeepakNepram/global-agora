import type { GlobeInputHandlers } from '../globe/bindControlInput';
import { createTapTracker } from '../globe/tapGesture';
import type { FlatControls } from './flatCamera';

/** Pixels per wheel line in deltaMode 1 (Firefox with a mouse wheel). */
const LINE_PX = 16;
/** A wheel's pixels to a zoom factor: exp(−delta · k), 100 px ≈ ×0.82. */
const WHEEL_ZOOM_PER_PX = 0.002;
/** A trackpad pinch arrives as small ctrl-wheel deltas; this many times stronger. */
const PINCH_WHEEL_GAIN = 4;

const NUDGES: Readonly<Record<string, readonly [east: number, north: number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/**
 * The flat map's pointer, wheel and keys (Prompt 5.1), as the globe's
 * (bindControlInput.ts) but with nothing animated: a drag moves the map
 * under the finger and stops with it, two fingers pinch, the wheel zooms
 * about the pointer. Taps and keys beyond moving go to `handlers`, the same
 * ones the globe uses. Returns an unbind function.
 */
export function bindMapInput(
  element: HTMLElement,
  controls: FlatControls,
  handlers: GlobeInputHandlers,
): () => void {
  const taps = createTapTracker();
  const pointers = new Map<number, { x: number; y: number }>();
  let rect = element.getBoundingClientRect();

  const local = (event: PointerEvent | WheelEvent): { x: number; y: number } => ({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    rect = element.getBoundingClientRect();
    element.setPointerCapture(event.pointerId);
    const at = local(event);
    pointers.set(event.pointerId, at);
    taps.down(event.pointerId, at.x, at.y, event.timeStamp, false);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const at = local(event);
    taps.move(event.pointerId, at.x, at.y);
    if (pointers.size === 1) {
      controls.panBy(at.x - previous.x, at.y - previous.y);
    } else {
      // Two fingers: zoom by the change in their spread, about their midpoint,
      // and move with the midpoint.
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(at.x - other.x, at.y - other.y);
        const mid = { x: (at.x + other.x) / 2, y: (at.y + other.y) / 2 };
        controls.panBy((at.x - previous.x) / 2, (at.y - previous.y) / 2);
        if (before > 0) controls.zoomAt(after / before, mid);
      }
    }
    pointers.set(event.pointerId, at);
  };

  const onPointerUp = (event: PointerEvent): void => {
    const at = local(event);
    pointers.delete(event.pointerId);
    if (taps.up(event.pointerId, at.x, at.y, event.timeStamp)) handlers.onTap(at.x, at.y);
  };

  const onPointerCancel = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    taps.cancel(event.pointerId);
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    rect = element.getBoundingClientRect();
    const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? rect.height : 1;
    const gain = event.ctrlKey ? PINCH_WHEEL_GAIN : 1;
    controls.zoomAt(Math.exp(-event.deltaY * unit * gain * WHEEL_ZOOM_PER_PX), local(event));
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== element || event.metaKey || event.ctrlKey || event.altKey) return;
    const nudge = NUDGES[event.key];
    let handled = true;
    if (nudge) controls.nudge(nudge[0], nudge[1]);
    else if (event.key === '+' || event.key === '=') controls.zoomStep('in');
    else if (event.key === '-' || event.key === '_') controls.zoomStep('out');
    else if (event.key === 'Enter' || event.key === ' ') {
      rect = element.getBoundingClientRect();
      handlers.onActivate(rect.width / 2, rect.height / 2);
    } else if (event.key === 'Home') handled = handlers.onHome();
    else if (event.key === 'Tab') handled = handlers.onTab(element, event.shiftKey);
    else handled = event.key === 'Escape' && handlers.onEscape();
    // Space would otherwise scroll the page.
    if (handled) event.preventDefault();
  };

  const onBlur = (): void => handlers.onBlur();

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('lostpointercapture', onPointerCancel);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('keydown', onKeyDown);
  element.addEventListener('blur', onBlur);
  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('lostpointercapture', onPointerCancel);
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('keydown', onKeyDown);
    element.removeEventListener('blur', onBlur);
  };
}
