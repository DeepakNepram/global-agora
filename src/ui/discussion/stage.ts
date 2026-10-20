import { discussionStageStore, monotonicNowMs } from '@/state';

import { createStageController, type StageController } from './stageController';
import { recedeAmount, segmentAt } from './stageMotion';

/**
 * The app's one discussion stage controller, on the browser's clock. Its
 * times are monotonicNowMs(), which shares its origin with requestAnimationFrame's
 * timestamps and the document timeline, so the panel's compositor animation
 * and the globe's frames read the same instants.
 */
export const discussionStage: StageController = createStageController(discussionStageStore, {
  now: monotonicNowMs,
  nextFrame: (callback) => void window.requestAnimationFrame(callback),
  setTimer: (callback, ms) => window.setTimeout(callback, ms),
  clearTimer: (handle) => window.clearTimeout(handle),
});

/** How far the globe has receded behind the panel right now, 0 to 1 (the render loop asks each frame). */
export function stageRecedeNow(): number {
  const state = discussionStageStore.getState();
  return state.phase === 'closed' ? 0 : recedeAmount(segmentAt(state.panel, monotonicNowMs()));
}
