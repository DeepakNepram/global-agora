import type { LatLon } from '@/core';
import type { OrbitGlobeControls } from '@/globe';
import { discussionStageStore, panelStore, storyStore } from '@/state';

import { loadDiscussion } from './loadDiscussion';
import { discussionStage } from './stage';

export interface EnterDiscussionOptions {
  /** The story's payload id. */
  readonly storySeq: number;
  /** Its uuid, which keys the discussion. */
  readonly storyId: string;
  readonly city: LatLon;
  /** The globe's controls when the globe is on screen; null in the list or on the flat map. */
  readonly controls: OrbitGlobeControls | null;
  readonly reducedMotion: boolean;
}

let opener: HTMLElement | null = null;

/**
 * Enters a story's discussion (Prompt 4.5). Waits for the panel and the SDK,
 * then saves the camera pose with getState() and stops any inertia or flight
 * at it (setState), so leaving returns to exactly this pose. Without the
 * globe on screen there is no camera shot: the panel comes in alone. The story sheet
 * steps aside and comes back as it was. Rejects if the panel cannot load.
 */
export async function enterDiscussion(options: EnterDiscussionOptions): Promise<void> {
  const active = document.activeElement;
  await loadDiscussion();
  if (discussionStageStore.getState().phase !== 'closed') return;
  opener = active instanceof HTMLElement ? active : null;

  const { controls } = options;
  const savedPose = controls?.getState() ?? null;
  if (controls && savedPose) controls.setState(savedPose);
  const sheet = storyStore.getState().sheet;
  storyStore.getState().close();
  panelStore.getState().close();
  discussionStage.open(
    {
      storySeq: options.storySeq,
      storyId: options.storyId,
      city: options.city,
      savedPose,
      returnSheet: sheet === 'closed' ? 'peek' : sheet,
    },
    options.reducedMotion,
  );
}

/** Whoever had focus when the discussion opened (its Discuss button), once. */
export function takeDiscussionOpener(): HTMLElement | null {
  const element = opener;
  opener = null;
  return element?.isConnected ? element : null;
}
