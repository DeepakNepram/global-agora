/**
 * When the globe's WebGL context is lost (Prompt 5.2): a GPU reset, a driver
 * update, a phone reclaiming memory from a background tab. The app replaces
 * the context and carries on; if it keeps happening, it stops trying and
 * shows the flat map, which needs no WebGL.
 */

/** Losses are counted over this long. */
export const CONTEXT_LOSS_WINDOW_MS = 10 * 60_000;
/** This many losses inside the window and the globe gives way to the flat map. */
export const CONTEXT_LOSSES_BEFORE_MAP = 3;
/**
 * How long to wait for the browser to say the context is back before making
 * a new one anyway: some never say so.
 */
export const CONTEXT_RESTORE_WAIT_MS = 1500;

export interface ContextLossVerdict {
  /** The losses still inside the window, this one included, oldest first. */
  readonly lossesMs: readonly number[];
  /** Too many: show the flat map rather than try again. */
  readonly giveUp: boolean;
}

export function afterContextLoss(lossesMs: readonly number[], nowMs: number): ContextLossVerdict {
  const recent = [...lossesMs.filter((at) => nowMs - at < CONTEXT_LOSS_WINDOW_MS), nowMs];
  return { lossesMs: recent, giveUp: recent.length >= CONTEXT_LOSSES_BEFORE_MAP };
}
