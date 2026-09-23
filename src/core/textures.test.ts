import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { QUALITY_TIERS } from './quality';
import {
  CLOUD_TEXTURE_WIDTH,
  PREVIEW_LAYERS,
  TEXTURE_LAYERS,
  previewTextureSet,
  textureSetForTier,
  type TextureLayer,
} from './textures';

describe('textureSetForTier', () => {
  it('builds tier-width URLs under the base path', () => {
    expect(textureSetForTier('medium')).toEqual({
      day: '/textures/day-4096.webp',
      night: '/textures/night-4096.webp',
      specular: '/textures/specular-4096.webp',
      clouds: '/textures/clouds-2048.webp',
    });
  });

  it.each(QUALITY_TIERS)('caps clouds at %s', (tier) => {
    expect(textureSetForTier(tier).clouds).toBe(`/textures/clouds-${CLOUD_TEXTURE_WIDTH}.webp`);
  });

  it('honours a sub-path base without doubling slashes', () => {
    expect(textureSetForTier('low', '/agora/textures/').day).toBe('/agora/textures/day-2048.webp');
  });
});

describe('previewTextureSet', () => {
  it("is LOW's day and night, so LOW downloads nothing extra", () => {
    expect(previewTextureSet()).toEqual({
      day: textureSetForTier('low').day,
      night: textureSetForTier('low').night,
    });
  });
});

describe('index.html preloads', () => {
  const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
  const preloads = [...html.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)].map(([tag]) => tag);

  it('fetch exactly the preview maps', () => {
    const hrefs = preloads.map((tag) => /\bhref="([^"]+)"/.exec(tag)?.[1]).sort();
    expect(hrefs).toEqual(PREVIEW_LAYERS.map((layer) => previewTextureSet()[layer]).sort());
  });

  it("match three's image requests, or the browser downloads each map twice", () => {
    // TextureLoader requests images with crossOrigin 'anonymous'; a preload in
    // another CORS mode is a different cache entry and goes unused.
    for (const tag of preloads) {
      expect(tag).toMatch(/\bas="image"/);
      expect(tag).toMatch(/\bcrossorigin="anonymous"/);
    }
  });
});

/**
 * Textures are gitignored, so a fresh clone or CI has no manifest until
 * `npm run textures` runs. Skip rather than fail — but when the manifest is
 * there, the resolver must agree with what the pipeline actually emitted.
 */
const manifestPath = fileURLToPath(new URL('../../public/textures/manifest.json', import.meta.url));
const hasManifest = existsSync(manifestPath);

interface ManifestLayer {
  readonly file: string;
}
interface Manifest {
  readonly tiers: Record<string, { readonly layers: Record<string, ManifestLayer | undefined> }>;
}

describe.skipIf(!hasManifest)('textureSetForTier vs public/textures/manifest.json', () => {
  const manifest = hasManifest
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest)
    : { tiers: {} };

  const cases: [string, TextureLayer][] = QUALITY_TIERS.flatMap((tier) =>
    TEXTURE_LAYERS.map((layer): [string, TextureLayer] => [tier, layer]),
  );

  it.each(cases)('%s / %s resolves to the file the pipeline emitted', (tier, layer) => {
    const emitted = manifest.tiers[tier]?.layers[layer]?.file;
    expect(emitted, `manifest has no ${tier}/${layer}`).toBeDefined();

    const resolved = textureSetForTier(tier as (typeof QUALITY_TIERS)[number])[layer];
    expect(resolved).toBe(`/textures/${emitted}`);

    const onDisk = fileURLToPath(new URL(`../../public/textures/${emitted}`, import.meta.url));
    expect(existsSync(onDisk), `${emitted} is in the manifest but not on disk`).toBe(true);
  });
});
