/**
 * Generates the 2K / 4K / 8K texture variants from the downloaded sources and
 * writes public/textures/manifest.json.
 *
 * Usage:  npm run textures:build
 *
 * Three things happen here that are not plain resizes:
 *
 * 1. **Specular mask is derived, not downloaded.** NASA no longer publishes a
 *    standalone land/water mask, so ocean is detected in the bathymetry map by
 *    blue dominance. Ratio thresholds rather than additive ones, so deep ocean
 *    (~10,30,60) and shallow tropical water (~60,140,160) both classify while
 *    desert (~180,160,120) and ice (~240,240,240) do not.
 *
 * 2. **Clouds gain an alpha channel.** The published composite is an opaque
 *    JPEG; luminance becomes alpha and RGB is flattened to white.
 *
 * 3. **Nothing is upscaled.** Output is clamped to the source width, so the
 *    2048px cloud composite stays 2048px on the high tier instead of being
 *    faked up to 8K. The manifest records what was actually emitted.
 */
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import {
  OUTPUT_DIR,
  SOURCE_DIR,
  TEXTURE_SOURCES,
  TIERS,
  TIER_TEXTURE_WIDTH,
  type TextureSource,
} from './textures.config.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(repoRoot, SOURCE_DIR);
const outputDir = join(repoRoot, OUTPUT_DIR);

/** Ocean is blue-dominant. Ratios in percent, to keep the inner loop on integers. */
const OCEAN_BLUE_OVER_RED = 118;
const OCEAN_BLUE_OVER_GREEN = 104;

const WEBP = { quality: 82, effort: 5 } as const;

interface LayerRecord {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

function sourceFor(id: TextureSource['id']): TextureSource {
  const found = TEXTURE_SOURCES.find((s) => s.id === id);
  if (!found) throw new Error(`No source configured for '${id}'`);
  return found;
}

async function sourcePath(source: TextureSource): Promise<string> {
  const path = join(sourceDir, source.file);
  try {
    await stat(path);
  } catch {
    throw new Error(`Missing ${source.file}. Run 'npm run textures:fetch' first.`);
  }
  return path;
}

async function record(file: string, width: number, height: number): Promise<LayerRecord> {
  const { size } = await stat(join(outputDir, file));
  return { file, width, height, bytes: size };
}

/** Plain resize + WebP. Used for day and night. */
async function emitResized(
  source: TextureSource,
  width: number,
  height: number,
): Promise<LayerRecord> {
  const file = `${source.id}-${width}.webp`;
  await sharp(await sourcePath(source), { limitInputPixels: false })
    .resize(width, height, { fit: 'fill' })
    .webp(WEBP)
    .toFile(join(outputDir, file));
  return record(file, width, height);
}

/** Ocean mask derived from the day map's bathymetry. */
async function emitSpecular(width: number, height: number): Promise<LayerRecord> {
  const day = sourceFor('day');
  const { data, info } = await sharp(await sourcePath(day), { limitInputPixels: false })
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mask = Buffer.alloc(info.width * info.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * info.channels;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    const isOcean = b * 100 > r * OCEAN_BLUE_OVER_RED && b * 100 > g * OCEAN_BLUE_OVER_GREEN;
    mask[pixel] = isOcean ? 255 : 0;
  }

  const file = `specular-${width}.webp`;
  await sharp(mask, { raw: { width: info.width, height: info.height, channels: 1 } })
    // A hard mask aliases badly along coastlines at grazing angles; half a pixel
    // of blur is enough to stop the shoreline crawling as the globe rotates.
    .blur(0.6)
    .webp(WEBP)
    .toFile(join(outputDir, file));

  return record(file, info.width, info.height);
}

/** Clouds, with luminance promoted to alpha. */
async function emitClouds(width: number, height: number): Promise<LayerRecord> {
  const clouds = sourceFor('clouds');
  const { data, info } = await sharp(await sourcePath(clouds), { limitInputPixels: false })
    .resize(width, height, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    const out = pixel * 4;
    rgba[out] = 255;
    rgba[out + 1] = 255;
    rgba[out + 2] = 255;
    rgba[out + 3] = data[pixel] ?? 0;
  }

  const file = `clouds-${width}.webp`;
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    // Cloud alpha is low-frequency, and WebP compresses alpha far more
    // aggressively than colour: alphaQuality 90 costs 1310KB here, 70 costs
    // 527KB for no visible difference at globe scale. The colour channels are
    // flat white and compress to nothing either way.
    .webp({ ...WEBP, alphaQuality: 70 })
    .toFile(join(outputDir, file));

  return record(file, info.width, info.height);
}

/** Never upscale: a 2048px source stays 2048px on the 8K tier. */
function clamp(tierWidth: number, source: TextureSource): { width: number; height: number } {
  const width = Math.min(tierWidth, source.width);
  return { width, height: width / 2 };
}

async function cleanPreviousOutput(): Promise<void> {
  const entries = await readdir(outputDir).catch(() => []);
  await Promise.all(
    entries
      .filter((name) => /^(day|night|clouds|specular)-\d+\.webp$/.test(name))
      .map((name) => unlink(join(outputDir, name))),
  );
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await cleanPreviousOutput();

  const day = sourceFor('day');
  const night = sourceFor('night');
  const clouds = sourceFor('clouds');
  const tiers: Record<string, unknown> = {};

  for (const tier of TIERS) {
    const target = TIER_TEXTURE_WIDTH[tier];
    console.log(`\n${tier} (${target}px)`);

    const dayBox = clamp(target, day);
    const nightBox = clamp(target, night);
    const cloudBox = clamp(target, clouds);

    const layers = {
      day: await emitResized(day, dayBox.width, dayBox.height),
      night: await emitResized(night, nightBox.width, nightBox.height),
      specular: await emitSpecular(dayBox.width, dayBox.height),
      clouds: await emitClouds(cloudBox.width, cloudBox.height),
    };

    let total = 0;
    for (const [name, layer] of Object.entries(layers)) {
      total += layer.bytes;
      const capped = layer.width < target ? '  (capped by source)' : '';
      console.log(
        `  ${name.padEnd(9)} ${layer.width}x${layer.height}  ${(layer.bytes / 1024).toFixed(0)}KB${capped}`,
      );
    }
    console.log(`  ${'total'.padEnd(9)} ${(total / 1_048_576).toFixed(2)}MB`);

    tiers[tier] = { textureWidth: target, bytes: total, layers };
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    note: 'Generated by scripts/process-textures.ts. Do not edit by hand.',
    tiers,
  };

  await writeFile(
    join(outputDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  console.log(`\nWrote ${OUTPUT_DIR}/manifest.json`);
}

main().catch((error: unknown) => {
  console.error(`\nprocess-textures failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
