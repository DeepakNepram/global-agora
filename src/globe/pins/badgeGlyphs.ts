/**
 * An orb's count badge. The vertex shader formats the count into up to four
 * glyph indices and the fragment shader draws them from a one-row atlas, so a
 * badge costs no geometry and no draw call. This is the CPU mirror of that
 * formatting, and the atlas contract src/ui draws to.
 */

/** The atlas row, left to right: the shaders index into it. */
export const BADGE_GLYPHS = '0123456789.k';

/** Width / height of one atlas cell. Every glyph gets the same advance. */
export const BADGE_CELL_ASPECT = 0.5;

const DOT = BADGE_GLYPHS.indexOf('.');
const K = BADGE_GLYPHS.indexOf('k');

/**
 * What a badge says: 7, 42, 999, 1.2k, 3k, 12k. It rounds down, so a badge
 * never claims more stories than there are.
 */
export function badgeGlyphIndices(count: number): number[] {
  const n = Math.max(0, Math.floor(count));
  if (n < 1) return [];
  if (n < 1000) return String(n).split('').map(Number);
  if (n < 10_000) {
    const tenths = Math.floor(n / 100);
    const whole = Math.floor(tenths / 10);
    const fraction = tenths % 10;
    return fraction === 0 ? [whole, K] : [whole, DOT, fraction, K];
  }
  const thousands = Math.floor(n / 1000);
  return [...String(thousands).split('').map(Number), K];
}

export function badgeText(count: number): string {
  return badgeGlyphIndices(count)
    .map((glyph) => BADGE_GLYPHS[glyph] ?? '')
    .join('');
}

/**
 * The shader's packing, one exact float (< 2^20):
 *   code = n + 16 · (g0 + 16·g1 + 256·g2 + 4096·g3)
 * where n is the glyph count and g0 the leftmost glyph.
 */
export function badgeCode(count: number): number {
  const glyphs = badgeGlyphIndices(count);
  return glyphs.length + 16 * glyphs.reduce((sum, glyph, at) => sum + glyph * 16 ** at, 0);
}

/** GLSL for the vertex shader: badgeCode, for counts up to 65,535. */
export const BADGE_CODE_GLSL = /* glsl */ `
float badgeCode(float count) {
  float n = floor(count + 0.5);
  if (n < 1.0) return 0.0;
  if (n < 10.0) return 1.0 + 16.0 * n;
  if (n < 100.0) return 2.0 + 16.0 * (floor(n / 10.0) + 16.0 * mod(n, 10.0));
  if (n < 1000.0) {
    return 3.0 + 16.0 * (floor(n / 100.0) + 16.0 * mod(floor(n / 10.0), 10.0) + 256.0 * mod(n, 10.0));
  }
  if (n < 10000.0) {
    float tenths = floor(n / 100.0);
    float whole = floor(tenths / 10.0);
    float fraction = mod(tenths, 10.0);
    if (fraction < 0.5) return 2.0 + 16.0 * (whole + 16.0 * ${K.toFixed(1)});
    return 4.0 + 16.0 * (whole + 16.0 * ${DOT.toFixed(1)} + 256.0 * fraction + 4096.0 * ${K.toFixed(1)});
  }
  float thousands = floor(n / 1000.0);
  return 3.0 + 16.0 * (floor(thousands / 10.0) + 16.0 * mod(thousands, 10.0) + 256.0 * ${K.toFixed(1)});
}
`;
