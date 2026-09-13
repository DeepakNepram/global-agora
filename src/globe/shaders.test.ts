import { describe, expect, it } from 'vitest';

import { EARTH_CHANNEL_INDEX, EARTH_FRAG, EARTH_VERT } from './shaders/earth.glsl';

/** Strips comments so a sampler name mentioned only in a comment cannot pass. */
function code(source: string): string {
  return source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('earth shaders', () => {
  const frag = code(EARTH_FRAG);

  it('encodes output colour space as the last statement', () => {
    // Without it the globe renders dark and desaturated; see EARTH_FRAG.
    const lines = frag
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    expect(lines.at(-2)).toBe('#include <colorspace_fragment>');
    expect(lines.at(-1)).toBe('}');
  });

  it.each(['uDayMap', 'uNightMap', 'uSpecularMask'])('samples %s', (sampler) => {
    expect(frag).toMatch(new RegExp(`uniform sampler2D ${sampler};`));
    expect(frag).toMatch(new RegExp(`texture2D\\(${sampler}, vUv\\)`));
  });

  it('handles every channel index the material can set', () => {
    for (const index of Object.values(EARTH_CHANNEL_INDEX).filter((i) => i !== 0)) {
      expect(frag).toContain(`uChannel == ${index}`);
    }
  });

  it('uses the geometry UVs rather than deriving them from position', () => {
    expect(code(EARTH_VERT)).toMatch(/vUv\s*=\s*uv;/);
  });
});
