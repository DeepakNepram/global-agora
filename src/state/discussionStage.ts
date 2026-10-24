import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { LatLon } from '@/core';

import type { SheetState } from './storyStore';

/**
 * The discussion stage (Prompt 4.5): whether a discussion is entering, open
 * or leaving, and the timing of every moving part, as plain data. The panel,
 * the globe's recede and the camera all read the same segments, so one clock
 * moves them together (src/ui/discussion/stageMotion.ts samples them; its
 * controller writes them).
 */

export type StagePhase = 'closed' | 'entering' | 'open' | 'leaving';

/**
 * One channel's motion over time, from 0 (on the globe) to 1 (in the
 * discussion). Held while a finger drags the panel, eased for entering and
 * leaving, sprung back after a release.
 */
export type StageSegment =
  | { readonly kind: 'held'; readonly value: number }
  | {
      readonly kind: 'ease';
      readonly from: number;
      readonly to: number;
      readonly startMs: number;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'spring';
      readonly from: number;
      readonly to: number;
      /** Per second, in the same 0–1 units. */
      readonly velocity: number;
      readonly startMs: number;
    };

/** The camera's leg of a transition: toward the city, or back to the saved pose. */
export interface CameraMove {
  readonly direction: 'in' | 'out';
  readonly startMs: number;
  readonly durationMs: number;
}

/** Where the camera was when the discussion opened: OrbitGlobeControls.getState(). */
export interface SavedPose extends LatLon {
  readonly altitudeKm: number;
}

export interface StageTarget {
  /** The story's payload id (the peek card's), to reopen its sheet on leaving. */
  readonly storySeq: number;
  /** The story's uuid, which keys its discussion. */
  readonly storyId: string;
  readonly city: LatLon;
  /**
   * Where the globe's camera was, which leaving restores; null when the
   * globe is not on screen (the list or the flat map, Prompt 5.1) and the
   * camera takes no part.
   */
  readonly savedPose: SavedPose | null;
  /** The story sheet's state before entering, given back on leaving. */
  readonly returnSheet: SheetState;
}

export interface StageState {
  readonly phase: StagePhase;
  /** Kept after closing, so the leave can be finished from it. */
  readonly target: StageTarget | null;
  /** The panel's position, the globe's recede and the lens shift. */
  readonly panel: StageSegment;
  /** The camera's current leg; null before entering starts and once it is done. */
  readonly camera: CameraMove | null;
  /** When the orbit began (the end of entering), or null. */
  readonly orbitFromMs: number | null;
  readonly dragging: boolean;
  /**
   * 'rest' is half resolution and 30 fps behind a settled panel; any motion
   * runs at full quality, so a resolution change never lands mid-motion.
   */
  readonly quality: 'full' | 'rest';
  /** No dolly, orbit or slide: the panel and the blur simply appear. */
  readonly reducedMotion: boolean;
  /** The area the stage covers (the globe's), CSS pixels. */
  readonly width: number;
  readonly height: number;
}

export type DiscussionStageStore = StoreApi<StageState>;

export const CLOSED_STAGE: StageState = {
  phase: 'closed',
  target: null,
  panel: { kind: 'held', value: 0 },
  camera: null,
  orbitFromMs: null,
  dragging: false,
  quality: 'full',
  reducedMotion: false,
  width: 0,
  height: 0,
};

export function createDiscussionStageStore(): DiscussionStageStore {
  return createStore<StageState>()(() => CLOSED_STAGE);
}

/** True from the moment a discussion starts opening until it has fully closed. */
export function stageActive(state: StageState): boolean {
  return state.phase !== 'closed';
}

/** The app's single stage. */
export const discussionStageStore: DiscussionStageStore = createDiscussionStageStore();

export function useDiscussionStage<T>(selector: (state: StageState) => T): T {
  return useStore(discussionStageStore, selector);
}
