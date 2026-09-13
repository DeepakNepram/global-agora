import {
  ClampToEdgeWrapping,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type ColorSpace,
  type Texture,
} from 'three';

import type { TextureLayer, TextureSet } from '@/core';

/**
 * Above 8x the extra taps cost real frame time on mobile GPUs and are invisible
 * at the limb, where anisotropy matters most on a sphere.
 */
export const MAX_ANISOTROPY = 8;

export type EarthTextures = Readonly<Record<TextureLayer, Texture>>;

export interface TextureLoadOptions {
  /** From renderer.capabilities.getMaxAnisotropy(). */
  readonly maxAnisotropy: number;
  /** Called once per layer as its image lands — the host should invalidate(). */
  readonly onLoad: (layer: TextureLayer) => void;
  readonly onError?: (layer: TextureLayer, error: unknown) => void;
}

/**
 * Photographic maps are sRGB-encoded; the specular mask is threshold data and
 * must be sampled as-is. Decoding it as sRGB would bend every value except 0 and 1.
 */
const COLOR_SPACE: Record<TextureLayer, ColorSpace> = {
  day: SRGBColorSpace,
  night: SRGBColorSpace,
  specular: NoColorSpace,
  clouds: SRGBColorSpace,
};

/**
 * Returns Texture objects immediately; their images fill in asynchronously.
 * That fits render-on-demand: materials are built at once, and each onLoad is
 * the one moment a new frame is actually needed. No suspense boundary, and
 * no dependency on r3f's loaders, which src/globe must not have.
 */
export function loadEarthTextures(set: TextureSet, options: TextureLoadOptions): EarthTextures {
  const loader = new TextureLoader();
  const anisotropy = Math.max(1, Math.min(options.maxAnisotropy, MAX_ANISOTROPY));

  const load = (layer: TextureLayer): Texture => {
    const texture = loader.load(
      set[layer],
      () => options.onLoad(layer),
      undefined,
      (error) => {
        if (options.onError) options.onError(layer, error);
        else console.error(`Globe texture "${layer}" failed to load from ${set[layer]}`, error);
      },
    );

    texture.colorSpace = COLOR_SPACE[layer];
    // Longitude wraps; latitude does not. Three defaults both to clamp, which
    // smears the edge texel column into a visible line at the antimeridian.
    texture.wrapS = RepeatWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.anisotropy = anisotropy;
    // Mipmaps and LinearMipmapLinear minification stay at three's defaults; the
    // 8192px tier aliases into shimmering noise without them.
    return texture;
  };

  return {
    day: load('day'),
    night: load('night'),
    specular: load('specular'),
    clouds: load('clouds'),
  };
}
