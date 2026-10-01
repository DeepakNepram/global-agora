/**
 * src/state — Zustand stores.
 *
 * Stores own plain data only. Keep Three.js objects out of them — mutating a
 * store every frame triggers React re-render storms and breaks render-on-demand.
 */
export { monotonicNowMs, wallClockNow } from './clock';
export {
  createTimeStore,
  timeStore,
  useTimeStore,
  LIVE_SYNC_INTERVAL_MS,
  type TimeMotion,
  type TimeState,
  type TimeStore,
} from './timeStore';
export {
  createNodesStore,
  nodesStore,
  useNodesStore,
  type NodesState,
  type NodesStatus,
  type NodesStore,
} from './nodesStore';
export {
  createStoryStore,
  ringedStory,
  storyStore,
  useStoryStore,
  type SheetState,
  type StoryState,
  type StoryStore,
} from './storyStore';
export {
  createSavedStore,
  savedStore,
  useSavedStore,
  SAVED_STORAGE_KEY,
  type SaveResult,
  type SavedState,
  type SavedStore,
  type SavedStory,
} from './savedStore';
export {
  createReportedStore,
  reportedStore,
  useReportedStore,
  REPORTED_MEMORY,
  REPORTED_STORAGE_KEY,
  type ReportedState,
  type ReportedStore,
} from './reportedStore';
export type { KeyValueStorage } from './persist';
