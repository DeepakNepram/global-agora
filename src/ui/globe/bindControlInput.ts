import type { OrbitGlobeControls, PointerInput } from '@/globe';

/** Pixels per wheel line in deltaMode 1 (Firefox with a mouse wheel). */
const LINE_PX = 16;

/**
 * A trackpad pinch reaches the page as wheel events with ctrlKey set and small
 * deltas; unscaled, a full pinch barely zooms. Scaling them also claims the
 * gesture from the browser's own page zoom (the wheel listener is not passive).
 */
const PINCH_WHEEL_GAIN = 4;

const NUDGES: Readonly<Record<string, readonly [east: number, north: number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

const ZOOM_IN_KEYS = new Set(['+', '=']);
const ZOOM_OUT_KEYS = new Set(['-', '_']);

/**
 * The DOM half of the camera controls: translates pointer, wheel and key
 * events on the globe element into the controls' plain-data input. A native
 * host replaces this file and nothing else. Returns an unbind function.
 *
 * Keys are bound to the element, not the window, so arrows and +/- only move
 * the globe while it has focus and never fight the time slider or page scroll.
 */
export function bindControlInput(element: HTMLElement, controls: OrbitGlobeControls): () => void {
  let rect = element.getBoundingClientRect();

  const toInput = (event: PointerEvent): PointerInput => ({
    id: event.pointerId,
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    timeMs: event.timeStamp,
  });

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    rect = element.getBoundingClientRect();
    element.setPointerCapture(event.pointerId);
    controls.pointerDown(toInput(event));
  };

  const onPointerMove = (event: PointerEvent): void => {
    // Chrome delivers one pointermove per frame; the coalesced samples between
    // them keep the flick velocity measurement from aliasing to the frame rate.
    const samples = event.getCoalescedEvents?.() ?? [];
    if (samples.length === 0) controls.pointerMove(toInput(event));
    for (const sample of samples) controls.pointerMove(toInput(sample));
  };

  const onPointerUp = (event: PointerEvent): void => controls.pointerUp(toInput(event));
  // Controls ignore ids they are not tracking, so a lostpointercapture after a
  // normal pointerup is harmless.
  const onPointerCancel = (event: PointerEvent): void => controls.pointerCancel(toInput(event));

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    rect = element.getBoundingClientRect();
    const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? rect.height : 1;
    const gain = event.ctrlKey ? PINCH_WHEEL_GAIN : 1;
    controls.wheel({
      deltaPx: event.deltaY * unit * gain,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== element || event.metaKey || event.ctrlKey || event.altKey) return;
    const nudge = NUDGES[event.key];
    if (nudge) controls.nudge(nudge[0], nudge[1]);
    else if (ZOOM_IN_KEYS.has(event.key)) controls.zoomStep('in');
    else if (ZOOM_OUT_KEYS.has(event.key)) controls.zoomStep('out');
    else return;
    event.preventDefault();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('lostpointercapture', onPointerCancel);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('keydown', onKeyDown);

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('lostpointercapture', onPointerCancel);
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('keydown', onKeyDown);
  };
}
