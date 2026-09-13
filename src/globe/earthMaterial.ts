import { ShaderMaterial, type Texture } from 'three';

import {
  EARTH_CHANNEL_INDEX,
  EARTH_FRAG,
  EARTH_VERT,
  type EarthChannel,
} from './shaders/earth.glsl';

export interface EarthMaps {
  readonly day: Texture;
  readonly night: Texture;
  readonly specular: Texture;
}

export interface EarthMaterial {
  readonly material: ShaderMaterial;
  setChannel(channel: EarthChannel): void;
}

export function createEarthMaterial(maps: EarthMaps, channel: EarthChannel = 'day'): EarthMaterial {
  // Held as a typed object rather than read back through material.uniforms,
  // whose index signature makes every access `IUniform | undefined`. three keeps
  // this same object, so mutating it updates the GPU uniform on the next draw.
  const uniforms = {
    uDayMap: { value: maps.day },
    uNightMap: { value: maps.night },
    uSpecularMask: { value: maps.specular },
    uChannel: { value: EARTH_CHANNEL_INDEX[channel] as number },
  };

  const material = new ShaderMaterial({
    vertexShader: EARTH_VERT,
    fragmentShader: EARTH_FRAG,
    uniforms,
  });

  return {
    material,
    setChannel(next) {
      uniforms.uChannel.value = EARTH_CHANNEL_INDEX[next];
    },
  };
}
