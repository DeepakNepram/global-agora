import { textureWidthForTier, type QualityTier } from './quality';

/**
 * Tier -> texture URL resolution.
 *
 * Derived from the naming convention scripts/process-textures.ts emits
 * (`<layer>-<width>.webp`) instead of fetching manifest.json at runtime: that
 * would be one more round-trip before the globe can start loading, spent on
 * information the build already fixed. src/core/textures.test.ts cross-checks
 * this against the real manifest so the two cannot drift silently.
 */

export const TEXTURE_LAYERS = ['day', 'night', 'specular', 'clouds'] as const;
export type TextureLayer = (typeof TEXTURE_LAYERS)[number];

export type TextureSet = Readonly<Record<TextureLayer, string>>;

/** Default mount point. Callers on a sub-path pass their own base. */
export const TEXTURE_BASE_PATH = '/textures';

/**
 * The largest equirectangular cloud composite NASA publishes is 2048x1024, and
 * the pipeline refuses to upscale. See docs/DECISIONS.md.
 */
export const CLOUD_TEXTURE_WIDTH = 2048;

export function textureFileName(layer: TextureLayer, width: number): string {
  return `${layer}-${width}.webp`;
}

/**
 * Layers drawn at low resolution while the tier's own maps download. Specular
 * has none: the lit view does not read it. Clouds have none: a moment without
 * clouds reads as weather, not as a missing globe.
 */
export const PREVIEW_LAYERS = ['day', 'night'] as const;
export type PreviewLayer = (typeof PREVIEW_LAYERS)[number];
export type PreviewTextureSet = Readonly<Record<PreviewLayer, string>>;

/**
 * The first maps the globe draws, whatever the tier: LOW's day and night
 * (272 KB together). index.html preloads exactly these, so they download
 * alongside the JavaScript rather than after it has run; the tier's maps
 * replace them as they arrive. On LOW they are the final maps, so LOW
 * downloads nothing extra. src/core/textures.test.ts keeps index.html in step.
 */
export function previewTextureSet(basePath: string = TEXTURE_BASE_PATH): PreviewTextureSet {
  const low = textureSetForTier('low', basePath);
  return { day: low.day, night: low.night };
}

export function textureSetForTier(
  tier: QualityTier,
  basePath: string = TEXTURE_BASE_PATH,
): TextureSet {
  const width = textureWidthForTier(tier);
  const base = basePath.replace(/\/+$/, '');
  const url = (layer: TextureLayer, w: number): string => `${base}/${textureFileName(layer, w)}`;

  return {
    day: url('day', width),
    night: url('night', width),
    specular: url('specular', width),
    clouds: url('clouds', Math.min(width, CLOUD_TEXTURE_WIDTH)),
  };
}
