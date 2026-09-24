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
export type { MockNodeOptions } from './mockNodes';

export { decodeNodes, fetchNodes, nodesUrl, NodesFetchError } from './data/nodes';
export type { FetchLike, FetchNodesOptions, FetchNodesResult } from './data/nodes';
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
