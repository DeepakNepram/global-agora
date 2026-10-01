import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import { monotonicNowMs, type SheetState } from '@/state';

import { dragPosition, snapStop, springAt, startSpring } from './sheetSpring';

/** Matches the globe's tap slop: under this a press on the sheet is a click, not a drag. */
const DRAG_SLOP_CSS_PX = 6;

/** Release velocity is measured over the last this-many ms of the drag. */
const VELOCITY_WINDOW_MS = 80;

/** Where the sheet's top sits for each state, as translateY in CSS px (0 is fully up). */
export type SheetStops = Readonly<Record<SheetState, number>>;

const ORDER: readonly SheetState[] = ['full', 'peek', 'closed'];

export interface SheetMotionHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

interface Drag {
  readonly id: number;
  readonly startY: number;
  readonly from: number;
  started: boolean;
  samples: { t: number; y: number }[];
}

/**
 * Moves the sheet: springs it to the stop for `state`, and lets a finger or
 * mouse drag it, handing the release velocity to the spring. Writes only the
 * element's transform, from requestAnimationFrame, so a drag or a spring
 * costs no React render and only the compositor's work. `canDrag` decides
 * which presses may become drags (in the full sheet, only its header).
 */
export function useSheetMotion(
  sheet: RefObject<HTMLElement | null>,
  stops: SheetStops,
  state: SheetState,
  reducedMotion: boolean,
  onRest: (state: SheetState) => void,
  canDrag: (target: EventTarget | null) => boolean,
): SheetMotionHandlers {
  const position = useRef({ y: stops.closed, v: 0 });
  const frame = useRef(0);
  const drag = useRef<Drag | null>(null);
  const shown = useRef<{ state: SheetState; stops: SheetStops } | null>(null);

  const write = useCallback(
    (y: number): void => {
      position.current.y = y;
      if (sheet.current) sheet.current.style.transform = `translate3d(0, ${y}px, 0)`;
    },
    [sheet],
  );

  const animateTo = useCallback(
    (to: number, velocity: number): void => {
      window.cancelAnimationFrame(frame.current);
      if (reducedMotion) {
        position.current.v = 0;
        write(to);
        return;
      }
      const spring = startSpring(position.current.y, velocity, to);
      const startMs = monotonicNowMs();
      const step = (): void => {
        const sample = springAt(spring, (monotonicNowMs() - startMs) / 1000);
        position.current.v = sample.velocity;
        write(sample.position);
        if (!sample.done) frame.current = window.requestAnimationFrame(step);
      };
      frame.current = window.requestAnimationFrame(step);
    },
    [reducedMotion, write],
  );

  // A new state springs from wherever the sheet is, keeping its velocity; a
  // resize alone moves it to the new stop at once. A layout effect, so the
  // first frame already has the sheet where it belongs.
  useLayoutEffect(() => {
    if (drag.current?.started) return;
    const previous = shown.current;
    shown.current = { state, stops };
    if (previous === null) {
      write(stops.closed);
      animateTo(stops[state], 0);
    } else if (previous.state !== state) {
      animateTo(stops[state], position.current.v);
    } else if (previous.stops !== stops) {
      // A drag's release already set its spring going; only a resize lands here.
      write(stops[state]);
    }
  }, [state, stops, animateTo, write]);

  useEffect(() => () => window.cancelAnimationFrame(frame.current), []);

  const release = (velocity: number): void => {
    const stopList = ORDER.map((name) => stops[name]);
    const rest = ORDER[snapStop(position.current.y, velocity, stopList)] ?? 'peek';
    shown.current = { state: rest, stops };
    animateTo(stops[rest], velocity);
    onRest(rest);
  };

  return {
    onPointerDown(event) {
      if ((event.pointerType === 'mouse' && event.button !== 0) || !canDrag(event.target)) return;
      drag.current = {
        id: event.pointerId,
        startY: event.clientY,
        from: position.current.y,
        started: false,
        samples: [],
      };
    },

    onPointerMove(event) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      const dy = event.clientY - current.startY;
      if (!current.started) {
        if (Math.abs(dy) < DRAG_SLOP_CSS_PX) return;
        current.started = true;
        window.cancelAnimationFrame(frame.current);
        // Captured only once it is a drag, so a press on a button still clicks.
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      write(dragPosition(current.from, dy, stops.full));
      current.samples.push({ t: event.timeStamp, y: position.current.y });
      const cutoff = event.timeStamp - VELOCITY_WINDOW_MS;
      while ((current.samples[0]?.t ?? Infinity) < cutoff) current.samples.shift();
    },

    onPointerUp(event) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      drag.current = null;
      if (!current.started) return;
      const first = current.samples[0];
      const last = current.samples.at(-1);
      const dt = first && last ? (last.t - first.t) / 1000 : 0;
      release(first && last && dt > 0 ? (last.y - first.y) / dt : 0);
    },

    onPointerCancel(event) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      drag.current = null;
      if (current.started) release(0);
    },
  };
}
