/**
 * Texture sources and the tier ladder.
 *
 * Every URL here was verified to return HTTP 200 and is public domain under
 * NASA's media usage policy — no API key, no attribution requirement beyond
 * crediting NASA. Provenance is written to public/textures/SOURCES.md by
 * `npm run textures:fetch`.
 */

export type TextureId = 'day' | 'night' | 'clouds';

export interface TextureSource {
  readonly id: TextureId;
  /** Filename written into public/textures/_source/. */
  readonly file: string;
  readonly url: string;
  /** Native size of the download, used to clamp upscaling. */
  readonly width: number;
  readonly height: number;
  /** Expected download size in bytes, for the progress line and a sanity check. */
  readonly approxBytes: number;
  readonly credit: string;
  readonly sourcePage: string;
  readonly notes: string;
}

export const TEXTURE_SOURCES: readonly TextureSource[] = [
  {
    id: 'day',
    file: 'day-source.jpg',
    url: 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/world.topo.bathy.200407.3x21600x10800.jpg',
    width: 21600,
    height: 10800,
    approxBytes: 27_200_000,
    credit: 'NASA Earth Observatory — Blue Marble: Next Generation (Reto Stöckli)',
    sourcePage:
      'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/',
    notes:
      'July 2004, with topography and bathymetry. The bathymetry version is what makes the ocean readable at globe scale, and it is the input the specular mask is derived from.',
  },
  {
    id: 'night',
    file: 'night-source.jpg',
    url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.13500x6750.jpg',
    width: 13500,
    height: 6750,
    approxBytes: 7_800_000,
    credit: 'NASA Earth Observatory — Black Marble 2012 (Suomi NPP VIIRS)',
    sourcePage: 'https://earthobservatory.nasa.gov/features/NightLights',
    notes: 'City lights composite. Drives the night side of the terminator shader in Phase 1.',
  },
  {
    id: 'clouds',
    file: 'clouds-source.jpg',
    url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg',
    width: 2048,
    height: 1024,
    approxBytes: 830_000,
    credit: 'NASA Earth Observatory — Blue Marble cloud composite',
    sourcePage: 'https://earthobservatory.nasa.gov/features/BlueMarble',
    notes:
      'Only a 2048x1024 equirectangular composite is published. The 21600x21600 files in the same record are quadrant tiles, not equirectangular, and are 202MB each — not worth stitching for a layer this low-frequency. Clouds are therefore capped at 2K on every tier; see process-textures.ts.',
  },
];

/**
 * The tier ladder is owned by the app, not by the build script — re-exported
 * here so a change to src/core/quality.ts cannot silently desync from the
 * textures actually on disk.
 */
export { QUALITY_TIERS as TIERS, TIER_TEXTURE_WIDTH } from '../src/core/quality.ts';
export type { QualityTier as TierName } from '../src/core/quality.ts';

/**
 * Downloaded originals live OUTSIDE public/. Vite copies public/ into dist/
 * verbatim, so keeping the 35MB of source JPEGs there shipped them to
 * production — 41MB of dist for ~6MB of actual textures.
 */
export const SOURCE_DIR = '.textures-cache';
export const OUTPUT_DIR = 'public/textures';
