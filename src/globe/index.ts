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
export { aimCamera, cameraPositionFor, earthTiltQuaternion } from './views';
export { MAX_ANISOTROPY } from './textureLoading';
