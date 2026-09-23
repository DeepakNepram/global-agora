import { FrontSide, ShaderMaterial, Vector3 } from 'three';

import { CLOUD_FRAG, CLOUD_VERT } from './shaders/cloud.glsl';
import type { TextureSlot } from './textureLoading';

export interface CloudMaterial {
  readonly material: ShaderMaterial;
  /** Unit vector toward the sun in the cloud shell's own (spun) frame. */
  readonly sunDirection: Vector3;
}

/**
 * A ShaderMaterial rather than MeshBasicMaterial, because clouds have to go dark
 * with the ground at the terminator. The texture is flat white with coverage in
 * alpha, so the shader only needs its alpha and the sun.
 */
/** `map` is a slot the loader fills, so the uniform follows a preview-to-full swap. */
export function createCloudMaterial(map: TextureSlot): CloudMaterial {
  const uniforms = {
    uCloudMap: map,
    uSunDir: { value: new Vector3(1, 0, 0) },
  };

  const material = new ShaderMaterial({
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    uniforms,
    transparent: true,
    // A transparent shell must not write depth, or its own back-facing
    // fragments and later transparent layers (atmosphere) get occluded.
    depthWrite: false,
    side: FrontSide,
  });

  // The caller writes into this Vector3 in place; three reads the same object.
  return { material, sunDirection: uniforms.uSunDir.value };
}
