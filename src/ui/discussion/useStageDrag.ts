import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

import { discussionStageStore } from '@/state';

import { discussionStage } from './stage';
import { dragPosition, panelTransform, type StageLayout } from './stageMotion';

/** Matches the sheets' slop: under this a press on the handle is a click, not a drag. */
const DRAG_SLOP_CSS_PX = 6;
/** Release velocity is measured over the last this-many ms. */
const VELOCITY_WINDOW_MS = 80;

export interface StageDragHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

interface Drag {
  readonly id: number;
  readonly startY: number;
  started: boolean;
  p: number;
  samples: { t: number; p: number }[];
}

/**
 * "Drag the panel down partway to peek at the globe, all the way to exit"
 * (Prompt 4.5), on the bottom layout. The panel follows the finger and the
 * globe clears behind it; let go and it springs back, unless it was past
 * halfway or flicked down, which leaves. Only the panel's handle starts a
 * drag, so the posts below still scroll.
 */
export function useStageDrag(
  panel: RefObject<HTMLElement | null>,
  layout: StageLayout,
): StageDragHandlers {
  const drag = useRef<Drag | null>(null);

  const release = (current: Drag, cancelled: boolean): void => {
    const first = current.samples[0];
    const last = current.samples.at(-1);
    const dt = first && last ? (last.t - first.t) / 1000 : 0;
    const velocity = !cancelled && first && last && dt > 0 ? (last.p - first.p) / dt : 0;
    discussionStage.dragEnd(current.p, velocity);
  };

  return {
    onPointerDown(event) {
      const state = discussionStageStore.getState();
      if (layout.kind !== 'bottom' || state.phase !== 'open') return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      drag.current = {
        id: event.pointerId,
        startY: event.clientY,
        started: false,
        p: 1,
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
        // Captured only once it is a drag, so a press on Leave still clicks.
        event.currentTarget.setPointerCapture(event.pointerId);
        discussionStage.dragStart();
      }
      current.p = dragPosition(1, dy, layout);
      if (panel.current) panel.current.style.transform = panelTransform(current.p, layout);
      discussionStage.dragTo(current.p);
      current.samples.push({ t: event.timeStamp, p: current.p });
      const cutoff = event.timeStamp - VELOCITY_WINDOW_MS;
      while ((current.samples[0]?.t ?? Infinity) < cutoff) current.samples.shift();
    },

    onPointerUp(event) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      drag.current = null;
      if (current.started) release(current, false);
    },

    onPointerCancel(event) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      drag.current = null;
      if (current.started) release(current, true);
    },
  };
}
