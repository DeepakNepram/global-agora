/**
 * src/core — models, types, data fetching and geo math.
 *
 * Framework-agnostic: no React, no DOM, no Three.js, no Supabase SDK, and never
 * an import from src/ui. Enforced by ESLint (@typescript-eslint/no-restricted-imports)
 * and by tests/boundaries.test.ts.
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
