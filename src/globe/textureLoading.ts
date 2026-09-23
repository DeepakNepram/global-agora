import {
  ClampToEdgeWrapping,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type ColorSpace,
} from 'three';

import { TEXTURE_LAYERS, type TextureLayer, type TextureSet } from '@/core';

/**
 * Above 8x the extra taps cost real frame time on mobile GPUs and are invisible
 * at the limb, where anisotropy matters most on a sphere.
 */
export const MAX_ANISOTROPY = 8;

/**
 * A texture in a uniform-shaped holder. Materials use the slot itself as their
 * uniform, so swapping a preview for the full map is one assignment here and
 * no material has to know it happened.
 */
export interface TextureSlot {
  value: Texture;
}

export interface EarthTextures {
  readonly slots: Readonly<Record<TextureLayer, TextureSlot>>;
  /** Disposes every texture created, and stops any stage not yet started. */
  dispose(): void;
}

/** Starts loading `url` into a Texture it returns at once. Injected in tests. */
export type LoadTexture = (
  url: string,
  onLoad: (texture: Texture) => void,
  onError: (error: unknown) => void,
) => Texture;

export interface TextureLoadOptions {
  /** From renderer.capabilities.getMaxAnisotropy(). */
  readonly maxAnisotropy: number;
  /** A map reached its slot (a preview or the full map): the host should invalidate(). */
  readonly onLoad: (layer: TextureLayer) => void;
  readonly onError?: (layer: TextureLayer, error: unknown) => void;
  /** Low-resolution stand-ins, drawn until each layer's full map arrives. */
  readonly preview?: Partial<Readonly<Record<TextureLayer, string>>> | undefined;
  readonly loadTexture?: LoadTexture;
}

/**
 * Full maps are requested in stages, each once the one before has landed, so
 * the day map (most of a first look at the globe) has the connection to itself
 * instead of sharing it with 500 KB of clouds. Night comes with clouds because a
 * preview already covers it; specular comes last because the lit view does not
 * read it.
 */
export const LOAD_STAGES: readonly (readonly TextureLayer[])[] = [
  ['day'],
  ['night', 'clouds'],
  ['specular'],
];

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

function threeLoader(): LoadTexture {
  const loader = new TextureLoader();
  return (url, onLoad, onError) => loader.load(url, onLoad, undefined, onError);
}

/**
 * Returns slots at once; images fill in asynchronously. That fits
 * render-on-demand: materials are built immediately, and each onLoad is the
 * one moment a new frame is needed. No suspense boundary, and no dependency on
 * r3f's loaders, which src/globe must not have.
 *
 * Until a layer's full map lands its slot holds the preview, if there is one,
 * or an empty texture, which samples black. A preview that arrives after its
 * full map (a warm cache) is discarded.
 */
export function loadEarthTextures(set: TextureSet, options: TextureLoadOptions): EarthTextures {
  const loadTexture = options.loadTexture ?? threeLoader();
  const anisotropy = Math.max(1, Math.min(options.maxAnisotropy, MAX_ANISOTROPY));
  const created: Texture[] = [];
  let disposed = false;

  const configure = (texture: Texture, layer: TextureLayer): Texture => {
    texture.colorSpace = COLOR_SPACE[layer];
    // Longitude wraps; latitude does not. Three defaults both to clamp, which
    // smears the edge texel column into a visible line at the antimeridian.
    texture.wrapS = RepeatWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.anisotropy = anisotropy;
    // Mipmaps and LinearMipmapLinear minification stay at three's defaults; the
    // 8192px tier aliases into shimmering noise without them.
    created.push(texture);
    return texture;
  };

  const reportError = (layer: TextureLayer, url: string, error: unknown): void => {
    if (options.onError) options.onError(layer, error);
    else console.error(`Globe texture "${layer}" failed to load from ${url}`, error);
  };

  const slots = {} as Record<TextureLayer, TextureSlot>;
  for (const layer of TEXTURE_LAYERS) {
    const previewUrl = options.preview?.[layer];
    if (previewUrl === undefined || previewUrl === set[layer]) {
      slots[layer] = { value: configure(new Texture(), layer) };
      continue;
    }
    const preview = loadTexture(
      previewUrl,
      (texture) => {
        // Still in its slot, so the full map has not beaten it here. Optional
        // because a loader may call back before the slot exists.
        if (!disposed && (slots[layer] as TextureSlot | undefined)?.value === texture) {
          options.onLoad(layer);
        }
      },
      (error) => reportError(layer, previewUrl, error),
    );
    slots[layer] = { value: configure(preview, layer) };
  }

  const runStage = (index: number): void => {
    const stage = LOAD_STAGES[index];
    if (!stage || disposed) return;
    let pending = stage.length;
    const settle = (): void => {
      pending -= 1;
      if (pending === 0) runStage(index + 1);
    };
    for (const layer of stage) {
      const slot = slots[layer];
      const url = set[layer];
      const full = loadTexture(
        url,
        (texture) => {
          if (disposed) return;
          // The preview or empty texture it replaces is never drawn again.
          slot.value.dispose();
          slot.value = texture;
          options.onLoad(layer);
          settle();
        },
        (error) => {
          reportError(layer, url, error);
          settle();
        },
      );
      configure(full, layer);
    }
  };
  runStage(0);

  return {
    slots,
    dispose() {
      disposed = true;
      for (const texture of created) texture.dispose();
    },
  };
}
