/**
 * src/core — models, types, data fetching and geo math.
 *
 * Framework-agnostic: no React, no DOM, no Three.js, and never an import from
 * src/ui. Enforced by ESLint (@typescript-eslint/no-restricted-imports) and by
 * tests/boundaries.test.ts.
 *
 * The Supabase SDK is confined to src/core/db, which is not re-exported here:
 * import '@/core/db' where it is needed, so the SDK stays out of the main bundle.
 */
export { resolveConfig, FREE_TIER_DEFAULTS } from './config';
export type { AppConfig, EnvBag } from './config';

export {
  decideTier,
  parseTierOverride,
  pickTier,
  textureWidthForTier,
  QUALITY_OVERRIDE_STORAGE_KEY,
  QUALITY_TIERS,
  TIER_TEXTURE_WIDTH,
} from './quality';
export type { DeviceCapabilities, QualityTier, TierDecision } from './quality';

export {
  degToRad,
  kmToWorld,
  latLonToUv,
  latLonToVec3,
  normalizeLon,
  uvToLatLon,
  vec3ToLatLon,
  worldToKm,
  EARTH_AXIAL_TILT_DEG,
  EARTH_RADIUS_KM,
  GLOBE_RADIUS,
} from './geo';
export type { LatLon, Uv, Vec3 } from './geo';

export { angularDistance, antipodalTangent, interpolateGreatCircle } from './greatCircle';

export { createNodeBuffer, nodeBufferCapacity, NEWS_CATEGORIES } from './nodeBuffer';
export type { NewsCategory, NodeBuffer } from './nodeBuffer';
export { fillMockNodes } from './mockNodes';
export type { MockNodeOptions, MockStack } from './mockNodes';

export { decodeNodes, fetchNodes, nodesUrl, NodesFetchError } from './data/nodes';
export type { FetchLike, FetchNodesOptions, FetchNodesResult } from './data/nodes';
export { retryDelayMs, startNodesFeed } from './data/nodesFeed';
export {
  fetchStory,
  locationReportUrl,
  parseStory,
  reportStoryLocation,
  safeHttpUrl,
  storyUrl,
  DISCUSSION_STATES,
  PLACE_SOURCES,
  StoryError,
  StoryGoneError,
} from './data/story';
export type {
  DiscussionState,
  FetchStoryOptions,
  PlaceSource,
  StoryArticle,
  StoryDetail,
  StoryDiscussion,
  StoryPlace,
} from './data/story';
export {
  groupByOutlet,
  leadOutlet,
  nearbyStories,
  outletName,
  placeConfidence,
  placeExplanation,
  rowOfStory,
  NEARBY_LIMIT,
  NEARBY_MAX_KM,
} from './story';
export type { NearbyOptions, NearbyStory, OutletGroup, PlaceConfidence } from './story';

// The cluster engine (./cluster/engine) is deliberately absent: it pulls in
// supercluster, which belongs in the worker chunk. The worker imports it directly.
export {
  CLUSTER_DEBOUNCE_MS,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS_PX,
  CLUSTER_REFERENCE_LAT_DEG,
  CLUSTER_TILE_PX,
  PETAL_LEVEL,
  UNCLUSTERED_LEVEL,
} from './cluster/constants';
export { CLUSTER_ROLE, countVisible, unclusteredLayout } from './cluster/layout';
export type { ClusterLayout, ClusterRole } from './cluster/layout';
export { clusterColumns, createClusterClient } from './cluster/clusterClient';
export type { ClusterClient, ClusterClientOptions } from './cluster/clusterClient';
export type { ClusterColumns, ClusterReply, ClusterRequest } from './cluster/protocol';
export type { NodesFeed, NodesFeedCallbacks, NodesFeedOptions, Timers } from './data/nodesFeed';
export {
  dequantizeLat,
  dequantizeLon,
  parseNodesPayload,
  quantizeLat,
  quantizeLon,
  COORD_SCALE,
  PAYLOAD_VERSION,
  PayloadError,
} from './data/payload';
export type { NodeColumns, NodesPayload } from './data/payload';

export { equationOfTimeMinutes, julianDay, subsolarPoint, sunDirection } from './sun';

export {
  fractionAt,
  histogramBuckets,
  historyRange,
  inMagnet,
  minutesAgo,
  playProgress,
  playSeconds,
  playStartMs,
  returnStep,
  storyHistogram,
  timeAt,
  HISTOGRAM_BUCKET_MINUTES,
  PLAY_RAMP_SECONDS,
  PLAY_SECONDS,
  RETURN_LAND_MS,
  RETURN_RATE_PER_SECOND,
} from './timeline';
export type { ReturnStep, StoryTimes, TimeRange } from './timeline';

export {
  decodePermalink,
  encodePermalink,
  formatLinkTime,
  isEmptyPermalink,
  parseLinkTime,
  withoutPermalink,
  PERMALINK_PARAMS,
} from './permalink';
export type { CameraView, Permalink } from './permalink';

export { createFrameStats, percentile } from './frameStats';
export type { FrameStats, FrameSummary } from './frameStats';

export {
  previewTextureSet,
  textureFileName,
  textureSetForTier,
  CLOUD_TEXTURE_WIDTH,
  PREVIEW_LAYERS,
  TEXTURE_BASE_PATH,
  TEXTURE_LAYERS,
} from './textures';
export type { PreviewLayer, PreviewTextureSet, TextureLayer, TextureSet } from './textures';
