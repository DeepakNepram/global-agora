import { describe, expect, it } from 'vitest';

import {
  BADGE_CODE_GLSL,
  BADGE_GLYPHS,
  badgeCode,
  badgeGlyphIndices,
  badgeText,
} from './badgeGlyphs';

/** Unpacks a code the way the fragment shader does. */
function decode(code: number): string {
  const n = code % 16;
  let glyphs = Math.floor(code / 16);
  let text = '';
  for (let at = 0; at < n; at++) {
    text += BADGE_GLYPHS[glyphs % 16] ?? '?';
    glyphs = Math.floor(glyphs / 16);
  }
  return text;
}

describe('badgeText', () => {
  it.each([
    [1, '1'],
    [9, '9'],
    [42, '42'],
    [999, '999'],
    [1000, '1k'],
    [1250, '1.2k'],
    [1299, '1.2k'],
    [3000, '3k'],
    [9999, '9.9k'],
    [10_000, '10k'],
    [65_535, '65k'],
  ])('shows %i as %s, never more than there are', (count, text) => {
    expect(badgeText(count)).toBe(text);
    expect(decode(badgeCode(count))).toBe(text);
  });

  it('shows nothing for no stories', () => {
    expect(badgeGlyphIndices(0)).toEqual([]);
    expect(badgeCode(0)).toBe(0);
  });

  it('fits every code in four glyphs and an exact float32', () => {
    for (let count = 1; count <= 65_535; count += 7) {
      const code = badgeCode(count);
      expect(code % 16).toBeLessThanOrEqual(4);
      expect(Math.fround(code)).toBe(code);
    }
  });

  it('is mirrored by the shader, with the atlas indices interpolated', () => {
    expect(BADGE_CODE_GLSL).toContain('float badgeCode(float count)');
    expect(BADGE_CODE_GLSL).not.toContain('${');
    expect(BADGE_CODE_GLSL).toContain(`16.0 * ${BADGE_GLYPHS.indexOf('k')}.0`);
  });
});
