import { ShaderMaterial } from 'three';

import type { Vec3 } from '@/core';

import {
  EARTH_CHANNEL_INDEX,
  EARTH_FRAG,
  EARTH_VERT,
  type EarthChannel,
} from './shaders/earth.glsl';
import { toVector3 } from './sunFrame';
import type { TextureSlot } from './textureLoading';

/** Slots, not textures: the loader swaps a preview for the full map inside them. */
export interface EarthMaps {
  readonly day: TextureSlot;
  readonly night: TextureSlot;
  readonly specular: TextureSlot;
}

export interface EarthMaterial {
  readonly material: ShaderMaterial;
  setChannel(channel: EarthChannel): void;
  /** Unit vector toward the sun in the Earth-fixed frame. */
  setSunDirection(direction: Vec3): void;
}

export function createEarthMaterial(
  maps: EarthMaps,
  channel: EarthChannel,
  sunDirection: Vec3,
): EarthMaterial {
  // Held as a typed object rather than read back through material.uniforms,
  // whose index signature makes every access `IUniform | undefined`. three keeps
  // this same object, so mutating it updates the GPU uniform on the next draw.
  const uniforms = {
    uDayMap: maps.day,
    uNightMap: maps.night,
    uSpecularMask: maps.specular,
    uSunDir: { value: toVector3(sunDirection) },
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
    setSunDirection(direction) {
      // Mutated in place: the uniform object is shared with the program cache.
      toVector3(direction, uniforms.uSunDir.value);
    },
  };
}
