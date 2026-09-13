import { describe, expect, it } from 'vitest';

import {
  ATMOSPHERE_RADIUS,
  ATMOSPHERE_VERT,
  RIM_FRAG,
  SCATTER_FRAG,
} from './shaders/atmosphere.glsl';
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
  ['atmosphere rim', RIM_FRAG],
  ['atmosphere scattering', SCATTER_FRAG],
])('%s fragment shader output', (_name, source) => {
  it('tone-maps, then encodes output colour space, as the last statements', () => {
    // Without colorspace_fragment the globe renders dark and desaturated (see
    // EARTH_FRAG). Without tonemapping_fragment the LOW tier gets no ACES, since
    // it has no composer to apply it.
    const lines = statements(source);
    expect(lines.at(-3)).toBe('#include <tonemapping_fragment>');
    expect(lines.at(-2)).toBe('#include <colorspace_fragment>');
    expect(lines.at(-1)).toBe('}');
  });

  it('has every TypeScript constant interpolated', () => {
    expect(source).not.toContain('${');
    expect(source).not.toMatch(/=\s*(undefined|NaN);/);
  });
});

describe.each([
  ['earth', EARTH_FRAG],
  ['cloud', CLOUD_FRAG],
])('%s fragment shader', (_name, source) => {
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
    // smoothstep(-f, 0, ndl) is 1 for every ndl >= 0, so 1 - it is exactly 0 on
    // the sunlit side: no light bleed across the terminator.
    expect(frag).toContain('float lightsOn = 1.0 - smoothstep(-LIGHTS_FADE, 0.0, ndl);');
    const fade = /const float LIGHTS_FADE = ([\d.]+);/.exec(frag);
    expect(Number(fade?.[1])).toBeGreaterThan(0);
    expect(frag).toMatch(/vec3 lights = night \* nightGain \* lightsOn;/);
    expect(frag).toMatch(/vec3 sunlit = day \* max\(ndl, 0\.0\) \* /);
    expect(frag).toContain('vec3 lit = mix(lights, sunlit, t);');
  });
});

describe('atmosphere shaders', () => {
  it('passes the object-space position, which is the frame of uSunDir', () => {
    expect(code(ATMOSPHERE_VERT)).toMatch(/vPosition\s*=\s*position;/);
    expect(code(ATMOSPHERE_VERT)).not.toContain('normalMatrix');
  });

  it.each([
    ['rim', RIM_FRAG],
    ['scattering', SCATTER_FRAG],
  ])('%s uses the shell radius the mesh is built with', (_name, source) => {
    expect(code(source)).toContain(`const float ATMOSPHERE_RADIUS = ${ATMOSPHERE_RADIUS};`);
    expect(code(source)).toMatch(/uniform vec3 uSunDir;/);
    expect(code(source)).toMatch(/uniform vec3 uCameraLocal;/);
  });

  it('rim uses the Prompt 1.3 Fresnel term', () => {
    expect(code(RIM_FRAG)).toContain('float rim = pow(1.0 - abs(dot(viewDir, normal)), 3.0);');
  });

  it('scattering marches a small fixed number of samples', () => {
    const frag = code(SCATTER_FRAG);
    const samples = /const int SAMPLES = (\d+);/.exec(frag);
    expect(Number(samples?.[1])).toBeGreaterThanOrEqual(4);
    expect(Number(samples?.[1])).toBeLessThanOrEqual(8);
    expect(frag).toContain('for (int i = 0; i < SAMPLES; i++)');
  });

  it('both cap radiance below the bloom threshold', () => {
    expect(code(RIM_FRAG)).toContain('min(color, vec3(MAX_LUMINANCE))');
    expect(code(SCATTER_FRAG)).toContain('min(color, vec3(alpha * MAX_LUMINANCE))');
  });
});
