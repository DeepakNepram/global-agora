import { useEffect, type RefObject } from 'react';

import { discussionStageStore, type StageSegment, type StageState } from '@/state';

import {
  LOW_SCRIM_OPACITY,
  panelTransform,
  recedeAmount,
  sampleAnimation,
  type StageLayout,
} from './stageMotion';

function endValue(segment: StageSegment): number {
  return segment.kind === 'held' ? segment.value : segment.to;
}

/**
 * Moves the panel (and the LOW tier's scrim) with the stage. Entering,
 * leaving and the spring-back run as compositor animations sampled from the
 * stage's own curve, started at the stage's own start time, so they keep 60
 * fps however busy the GPU is with the globe behind; a drag writes the
 * transform straight from the pointer. No React render either way.
 */
export function usePanelMotion(
  panel: RefObject<HTMLElement | null>,
  scrim: RefObject<HTMLElement | null>,
  layout: StageLayout,
): void {
  useEffect(() => {
    let running: Animation[] = [];

    const move = (
      element: HTMLElement | null,
      segment: StageSegment,
      state: StageState,
      style: (p: number) => Keyframe,
    ): void => {
      if (!element) return;
      // The resting style underneath: where the animation ends, or the finger.
      Object.assign(element.style, style(endValue(segment)));
      const sampled = state.reducedMotion ? null : sampleAnimation(segment, style);
      if (!sampled || segment.kind === 'held') return;
      const animation = element.animate(sampled.keyframes, {
        duration: sampled.durationMs,
        easing: 'linear',
      });
      // The document timeline shares performance.now()'s origin, so this
      // starts the animation exactly when the globe's leg started.
      animation.startTime = segment.startMs;
      running.push(animation);
    };

    const apply = (state: StageState): void => {
      for (const animation of running) animation.cancel();
      running = [];
      move(panel.current, state.panel, state, (p) => ({ transform: panelTransform(p, layout) }));
      move(scrim.current, state.panel, state, (p) => ({
        opacity: String(LOW_SCRIM_OPACITY * recedeAmount(p)),
      }));
    };

    apply(discussionStageStore.getState());
    const unsubscribe = discussionStageStore.subscribe((state, previous) => {
      if (state.panel !== previous.panel || state.reducedMotion !== previous.reducedMotion)
        apply(state);
    });
    return () => {
      unsubscribe();
      for (const animation of running) animation.cancel();
    };
  }, [panel, scrim, layout]);
}
