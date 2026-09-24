import { CanvasTexture, LinearFilter, NoColorSpace } from 'three';

import { BADGE_CELL_ASPECT, BADGE_GLYPHS } from '@/globe';

/** Cell height in canvas pixels: sharp down to ~10 px text at a device pixel ratio of 3. */
const CELL_HEIGHT = 64;

/**
 * The count glyphs for cluster orbs: one row, BADGE_GLYPHS in order, white on
 * transparent, in the app's own font. Drawing text needs a canvas, which is
 * DOM, so it is made here and src/globe receives only the texture.
 */
export function createBadgeAtlas(fontFamily: string): CanvasTexture | null {
  const cellWidth = Math.round(CELL_HEIGHT * BADGE_CELL_ASPECT);
  const canvas = document.createElement('canvas');
  canvas.width = cellWidth * BADGE_GLYPHS.length;
  canvas.height = CELL_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.fillStyle = '#fff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  // Each glyph is centred in a fixed-width cell, so proportional digits still
  // line up as the shader's fixed advance expects.
  context.font = `700 ${Math.round(CELL_HEIGHT * 0.7)}px ${fontFamily}`;
  [...BADGE_GLYPHS].forEach((glyph, at) => {
    context.fillText(glyph, (at + 0.5) * cellWidth, CELL_HEIGHT * 0.54);
  });

  const texture = new CanvasTexture(canvas);
  // Only alpha is read, as ink coverage. No mipmaps: the fragment shader
  // samples inside a branch, which is only well defined without them.
  texture.colorSpace = NoColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}
