/**
 * src/globe — the Three.js render layer.
 *
 * Three.js only: no React (not even r3f), no DOM, no Supabase, no state store,
 * and never an import from src/ui. Data comes in as arguments and the layer
 * hands back plain Object3Ds with a dispose(). src/ui mounts them through r3f's
 * <primitive>; a native host would mount the same objects its own way. Enforced
 * by ESLint (@typescript-eslint/no-restricted-imports) and tests/boundaries.test.ts.
 */
export { smoothTowards } from './smoothing';

export {
  createEarth,
  CLOUD_ANGULAR_SPEED,
  CLOUD_RADIUS,
  EARTH_SEGMENTS,
  type EarthLayer,
  type EarthOptions,
} from './earth';
export { EARTH_CHANNEL_INDEX, type EarthChannel } from './shaders/earth.glsl';
export { sunInSpinFrame, toVector3 } from './sunFrame';
export { earthTiltQuaternion } from './views';
export { createOrbitGlobeControls } from './camera/OrbitGlobeControls';
export {
  CAMERA_FOV_DEG,
  MAX_LATITUDE_DEG,
  MIN_ALTITUDE_KM,
  altitudeToShowKm,
  fitAltitudeKm,
  radiansPerScreenHeight,
  type CameraPose,
} from './camera/cameraMath';
export { easeInOutCubic, flightDurationMs, type FlightResult } from './camera/flight';
export {
  applyShot,
  orbitShot,
  planShotMove,
  poseShot,
  shotDistanceKm,
  shotTransform,
  SHOT_TILT_RAD,
  type LensShift,
  type ShotMove,
  type ShotPose,
  type ShotTransform,
} from './camera/discussionShot';
export type { PointerInput } from './camera/pointerGestures';
export type {
  AltitudeLimits,
  ControlsMode,
  ControlsTelemetry,
  FlyToOptions,
  MotionPreference,
  OrbitGlobeControls,
  OrbitGlobeControlsOptions,
  WheelInput,
} from './camera/types';
export {
  createPinLayer,
  type PickViewport,
  type PinLayer,
  type PinLayerOptions,
  type PresentOptions,
  type PresentResult,
  type TargetBounds,
} from './pins/pinLayer';
export {
  ACTIVATE_RADIUS_CSS_PX,
  PICK_RADIUS_CSS_PX,
  drawnTargets,
  locateRow,
  pickPin,
  type PickInput,
  type PinPick,
  type PinTarget,
  type ProjectPoint,
  type ScreenPoint,
} from './pins/pinPick';
// The pins' look, for the flat map (Prompt 5.1), which draws them in 2D.
export {
  BADGE_INK,
  CATEGORY_HUES,
  CORE_RADIUS,
  FILTERED_ALPHA,
  FILTERED_SCALE,
  ORB_CORE_RADIUS,
  ORB_RIM_DARKEN,
  PIN_HALF_SIZE_CSS_PX,
  SELECTION_RING_GAP_CSS_PX,
  SELECTION_RING_WIDTH_CSS_PX,
  colorGainFor,
  freshnessFor,
  orbScaleFor,
  scaleForHeat,
} from './pins/pinStyle';
export {
  ORB_MARK_CENTRE,
  ORB_MARK_OUTLINE_CSS_PX,
  ORB_MARK_RADIUS,
  ORB_REACH,
  PIN_REACH,
} from './pins/pinShapes.glsl';
export { groupMatches } from './pins/pinFilter';
export { BADGE_CELL_ASPECT, BADGE_GLYPHS, badgeText } from './pins/badgeGlyphs';
export { BLOOM_SETTLE_SECONDS, bloomSeconds, petalOffset } from './pins/bloom';
export {
  altitudeKmAt,
  altitudeKmForZoom,
  clusterZoomFor,
  nextClusterLevel,
  LEVEL_HYSTERESIS,
} from './pins/clusterZoom';
export { MAX_ANISOTROPY } from './textureLoading';
export { ATMOSPHERE_RADIUS } from './shaders/atmosphere.glsl';
export { BLOOM_THRESHOLD, NIGHT_LIGHTS_GAIN, ATMOSPHERE_MAX_LUMINANCE } from './hdr';
export { createGpuTimer, type GpuTimer } from './gpuTimer';
export { renderSettingsForTier, type AtmosphereMode, type RenderSettings } from './renderSettings';
export { createRenderPipeline, VIGNETTE, type RenderPipeline } from './renderPipeline';
export { recedeLook, type RecedeLook } from './recede';
