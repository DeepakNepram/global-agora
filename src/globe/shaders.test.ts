import { describe, expect, it } from 'vitest';

import { CLOUD_FRAG, CLOUD_VERT } from './shaders/cloud.glsl';
import { EARTH_CHANNEL_INDEX, EARTH_FRAG, EARTH_VERT } from './shaders/earth.glsl';

/** Strips comments so a name mentioned only in a comment cannot pass. */
function code(source: string): string {
  return source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function statements(source: string): string[] {
  return code(source)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

describe.each([
  ['earth', EARTH_FRAG],
  ['cloud', CLOUD_FRAG],
])('%s fragment shader', (_name, source) => {
  it('encodes output colour space as the last statement', () => {
    // Without it the globe renders dark and desaturated; see EARTH_FRAG.
    const lines = statements(source);
    expect(lines.at(-2)).toBe('#include <colorspace_fragment>');
    expect(lines.at(-1)).toBe('}');
  });

  it('lights from the uSunDir uniform against the renormalised normal', () => {
    const frag = code(source);
    expect(frag).toMatch(/uniform vec3 uSunDir;/);
    expect(frag).toMatch(/float ndl = dot\(normalize\(vNormal\), uSunDir\);/);
  });

  it('uses the ±0.10 terminator band', () => {
    const frag = code(source);
    expect(frag).toMatch(/const float TERMINATOR_HALF_WIDTH = 0\.10;/);
    expect(frag).toContain('smoothstep(-TERMINATOR_HALF_WIDTH, TERMINATOR_HALF_WIDTH, ndl)');
  });
});

describe.each([
  ['earth', EARTH_VERT],
  ['cloud', CLOUD_VERT],
])('%s vertex shader', (_name, source) => {
  it('uses the geometry UVs rather than deriving them from position', () => {
    expect(code(source)).toMatch(/vUv\s*=\s*uv;/);
  });

  it('passes the object-space normal, matching the frame of uSunDir', () => {
    // normalMatrix would put the normal in view space and the lighting would
    // follow the camera instead of the sun.
    expect(code(source)).toMatch(/vNormal\s*=\s*normal;/);
    expect(code(source)).not.toContain('normalMatrix');
  });
});

describe('earth fragment shader', () => {
  const frag = code(EARTH_FRAG);

  it.each(['uDayMap', 'uNightMap', 'uSpecularMask'])('samples %s', (sampler) => {
    expect(frag).toMatch(new RegExp(`uniform sampler2D ${sampler};`));
    expect(frag).toMatch(new RegExp(`texture2D\\(${sampler}, vUv\\)`));
  });

  it('handles every channel index the material can set', () => {
    for (const index of Object.values(EARTH_CHANNEL_INDEX).filter((i) => i !== 0)) {
      expect(frag).toContain(`uChannel == ${index}`);
    }
  });

  it('gates city lights to where the sun has set', () => {
    // smoothstep(-w, 0, ndl) is 1 for every ndl >= 0, so 1 - it is exactly 0 on
    // the sunlit side: no light bleed across the terminator.
    expect(frag).toContain('float lightsOn = 1.0 - smoothstep(-TERMINATOR_HALF_WIDTH, 0.0, ndl);');
    expect(frag).toMatch(/vec3 lights = night \* NIGHT_LIGHTS_GAIN \* lightsOn;/);
    expect(frag).toMatch(/vec3 sunlit = day \* max\(ndl, 0\.0\) \* /);
    expect(frag).toContain('vec3 lit = mix(lights, sunlit, t);');
  });
});
