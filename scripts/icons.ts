/**
 * Renders the app's icons from public/favicon.svg (Prompt 5.2):
 *
 *   npm run icons
 *
 * The SVG is full-bleed with its art inside the central 80% circle, so one
 * drawing serves every purpose: the manifest's "any" and "maskable" icons
 * (Android crops maskable ones to its own shape) and iOS's home-screen icon,
 * which iOS rounds itself. The PNGs are committed; rerun after editing the SVG.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repoRoot, 'public', 'favicon.svg');
const outDir = join(repoRoot, 'public', 'icons');

/** File name → pixel size. */
const ICONS: Readonly<Record<string, number>> = {
  'icon-192.png': 192,
  'icon-512.png': 512,
  'icon-maskable-512.png': 512,
  'apple-touch-icon.png': 180,
};

const svg = await readFile(source);
await mkdir(outDir, { recursive: true });
for (const [name, size] of Object.entries(ICONS)) {
  // Rendered at the target size rather than scaled down, so thin strokes stay sharp.
  await sharp(svg, { density: (72 * size) / 512 })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true })
    .toFile(join(outDir, name));
  console.log(`public/icons/${name}  ${size}×${size}`);
}
