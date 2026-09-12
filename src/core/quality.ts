/**
 * Device quality tiers.
 *
 * This module is deliberately **pure**: it takes already-measured capabilities
 * and returns a tier. Nothing here touches WebGL, `navigator` or `localStorage`,
 * because src/core must stay DOM-free and framework-agnostic (CLAUDE.md
 * "Directory rules"). The measuring half lives in
 * `src/ui/platform/capabilities.ts`, which is the layer that gets swapped out in
 * a native port. Same shape as `resolveConfig(env)` in ./config.
 *
 * Bias is conservative. The budget is 30fps on a mid-range Android in Chrome, so
 * anything that looks mobile-class gets `medium` rather than being given an 8K
 * texture set to prove itself with.
 */

export type QualityTier = 'low' | 'medium' | 'high';

export const QUALITY_TIERS: readonly QualityTier[] = ['low', 'medium', 'high'];

/** Longest edge of the texture set each tier loads. Mirrored by scripts/process-textures.ts. */
export const TIER_TEXTURE_WIDTH: Record<QualityTier, number> = {
  low: 2048,
  medium: 4096,
  high: 8192,
};

/** localStorage key for the manual override. Read in src/ui/platform. */
export const QUALITY_OVERRIDE_STORAGE_KEY = 'agora.quality-tier';

export interface DeviceCapabilities {
  /** gl.getParameter(gl.MAX_TEXTURE_SIZE). A hard ceiling — not a preference. */
  readonly maxTextureSize: number;
  /** UNMASKED_RENDERER_WEBGL, or '' when the extension is unavailable. */
  readonly rendererDescription: string;
  /** navigator.deviceMemory in GB. null where unimplemented (Safari, Firefox). */
  readonly deviceMemoryGb: number | null;
  /** navigator.hardwareConcurrency. null where unavailable. */
  readonly hardwareConcurrency: number | null;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly devicePixelRatio: number;
}

export interface TierDecision {
  readonly tier: QualityTier;
  /** Why this tier was chosen. Surfaced in the Phase 1 FPS overlay. */
  readonly reason: string;
}

/** Rasterising in software. Never give these anything but the smallest set. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|microsoft basic|mesa offscreen/i;

/** GPUs that struggle at 4K textures: older Mali, Adreno 3xx-5xx, pre-Rogue PowerVR. */
const WEAK_GPU = /mali-4\d\d|mali-t[0-7]\d\d|adreno[^0-9]*[345]\d\d|powervr sgx|videocore/i;

/** Anything mobile-class. Capable, but not with an 8K set on a thermal budget. */
const MOBILE_GPU = /adreno|mali|powervr|immortalis|xclipse|apple gpu|apple a\d/i;

/** Below this many physical pixels, an 8K texture set is wasted VRAM. */
const HIGH_TIER_MIN_PHYSICAL_PIXELS = 2_300_000;

/**
 * Physical pixels, or null when the display cannot be measured.
 *
 * Returning null rather than 0 matters: some embedded webviews and headless
 * contexts report `screen.width === 0`, and treating that as "small" would
 * silently demote a capable machine. Unknown means "do not apply this check",
 * exactly as a null deviceMemory does.
 */
function physicalPixels(caps: DeviceCapabilities): number | null {
  if (caps.screenWidth <= 0 || caps.screenHeight <= 0) return null;
  const dpr = caps.devicePixelRatio > 0 ? caps.devicePixelRatio : 1;
  return caps.screenWidth * dpr * (caps.screenHeight * dpr);
}

/** The best tier this GPU can physically upload, regardless of preference. */
function hardwareCeiling(maxTextureSize: number): QualityTier {
  if (maxTextureSize >= TIER_TEXTURE_WIDTH.high) return 'high';
  if (maxTextureSize >= TIER_TEXTURE_WIDTH.medium) return 'medium';
  return 'low';
}

function lower(a: QualityTier, b: QualityTier): QualityTier {
  return QUALITY_TIERS.indexOf(a) <= QUALITY_TIERS.indexOf(b) ? a : b;
}

/**
 * Validates a raw override value (typically straight out of localStorage).
 * Returns null for anything unrecognised rather than throwing, so a stale or
 * hand-edited value degrades to automatic detection instead of a blank globe.
 */
export function parseTierOverride(raw: string | null | undefined): QualityTier | null {
  if (raw === null || raw === undefined) return null;
  const normalised = raw.trim().toLowerCase();
  return QUALITY_TIERS.find((tier) => tier === normalised) ?? null;
}

/**
 * Picks a tier, with the reason recorded.
 *
 * An `override` forces the tier but is still clamped by `maxTextureSize`:
 * forcing `high` on a GPU that cannot upload an 8192px texture would fail to
 * render at all, and a silent black globe is a worse debugging experience than
 * being quietly capped.
 */
export function decideTier(
  caps: DeviceCapabilities,
  override: QualityTier | null = null,
): TierDecision {
  const ceiling = hardwareCeiling(caps.maxTextureSize);

  if (override !== null) {
    const tier = lower(override, ceiling);
    return tier === override
      ? { tier, reason: `forced to '${override}' by manual override` }
      : {
          tier,
          reason: `override '${override}' capped to '${tier}': MAX_TEXTURE_SIZE is ${caps.maxTextureSize}`,
        };
  }

  if (caps.maxTextureSize < TIER_TEXTURE_WIDTH.medium) {
    return { tier: 'low', reason: `MAX_TEXTURE_SIZE is only ${caps.maxTextureSize}` };
  }
  if (SOFTWARE_RENDERER.test(caps.rendererDescription)) {
    return { tier: 'low', reason: `software renderer: ${caps.rendererDescription}` };
  }
  if (caps.deviceMemoryGb !== null && caps.deviceMemoryGb <= 2) {
    return { tier: 'low', reason: `only ${caps.deviceMemoryGb}GB device memory` };
  }
  if (WEAK_GPU.test(caps.rendererDescription)) {
    return { tier: 'low', reason: `known-weak GPU: ${caps.rendererDescription}` };
  }

  if (ceiling === 'medium') {
    return { tier: 'medium', reason: `MAX_TEXTURE_SIZE is ${caps.maxTextureSize}` };
  }
  if (caps.deviceMemoryGb !== null && caps.deviceMemoryGb <= 4) {
    return { tier: 'medium', reason: `${caps.deviceMemoryGb}GB device memory` };
  }
  if (caps.hardwareConcurrency !== null && caps.hardwareConcurrency <= 4) {
    return { tier: 'medium', reason: `${caps.hardwareConcurrency} logical cores` };
  }
  if (MOBILE_GPU.test(caps.rendererDescription)) {
    return { tier: 'medium', reason: `mobile-class GPU: ${caps.rendererDescription}` };
  }
  const pixels = physicalPixels(caps);
  if (pixels !== null && pixels < HIGH_TIER_MIN_PHYSICAL_PIXELS) {
    return {
      tier: 'medium',
      reason: `small display (${Math.round(pixels / 1000)}k physical pixels)`,
    };
  }

  return { tier: 'high', reason: 'no constraint hit' };
}

export function pickTier(
  caps: DeviceCapabilities,
  override: QualityTier | null = null,
): QualityTier {
  return decideTier(caps, override).tier;
}

export function textureWidthForTier(tier: QualityTier): number {
  return TIER_TEXTURE_WIDTH[tier];
}
