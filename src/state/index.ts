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
