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
  connectivityStore,
  createConnectivityStore,
  useConnectivityStore,
  type ConnectivityState,
  type ConnectivityStore,
} from './connectivityStore';
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
  savedKey,
  savedStore,
  useSavedStore,
  SAVED_STORAGE_KEY,
  type SaveResult,
  type SavedState,
  type SavedStore,
  type SavedStory,
} from './savedStore';
export {
  createFollowsStore,
  followsStore,
  isFollowing,
  useFollowsStore,
  FOLLOWS_STORAGE_KEY,
  type FollowInput,
  type FollowResult,
  type FollowsState,
  type FollowsStore,
} from './followsStore';
export {
  enterAccount,
  leaveAccount,
  libraryStatus,
  useLibraryStatus,
  MOVE_UP_FAILED,
  type LibraryMode,
  type LibraryStatus,
  type LibraryStatusStore,
  type LibraryStores,
} from './library';
export {
  hasStoredSession,
  loadAccountSession,
  type AccountSession,
  type SessionUser,
} from './accountSession';
export {
  accountStore,
  createAccountStore,
  useAccountStore,
  type AccountSheet,
  type AccountState,
  type AccountStatus,
  type AccountStore,
  type SetupStep,
} from './accountStore';
export {
  accountProblem,
  DELETED_NOTICE,
  UNDER_AGE_NOTICE,
  UNREACHABLE_NOTICE,
} from './accountMessages';
export {
  createAccountController,
  type AccountController,
  type AccountControllerOptions,
  type AccountEnvironment,
  type LibraryLink,
} from './accountController';
export {
  browserAccountEnvironment,
  getAccountController,
  getAccountSession,
  getUpdatesController,
  startAccounts,
} from './accounts';
export {
  createUpdatesController,
  createUpdatesStore,
  updatesStore,
  useUpdatesStore,
  UPDATES_SHOWN,
  type UpdatesController,
  type UpdatesControllerOptions,
  type UpdatesState,
  type UpdatesStore,
} from './updates';
export {
  createReportedStore,
  reportedStore,
  useReportedStore,
  REPORTED_MEMORY,
  REPORTED_STORAGE_KEY,
  type ReportedState,
  type ReportedStore,
} from './reportedStore';
export {
  createFilterStore,
  filterStore,
  useFilterStore,
  type FilterState,
  type FilterStore,
} from './filterStore';
export {
  createPanelStore,
  panelStore,
  usePanelStore,
  type LibraryPanel,
  type PanelState,
  type PanelStore,
} from './panelStore';
export {
  createOnboardingStore,
  onboardingStore,
  useOnboardingStore,
  ONBOARDING_AFTER_SECONDS,
  ONBOARDING_STORAGE_KEY,
  type HomeCity,
  type OnboardingState,
  type OnboardingStatus,
  type OnboardingStore,
} from './onboardingStore';
export {
  CLOSED_STAGE,
  createDiscussionStageStore,
  discussionStageStore,
  stageActive,
  useDiscussionStage,
  type CameraMove,
  type DiscussionStageStore,
  type SavedPose,
  type StagePhase,
  type StageSegment,
  type StageState,
  type StageTarget,
} from './discussionStage';
export type { KeyValueStorage } from './persist';
export {
  createViewStore,
  useViewStore,
  viewStore,
  VIEW_STORAGE_KEY,
  type NewsLayout,
  type ViewState,
  type ViewStore,
} from './viewStore';
