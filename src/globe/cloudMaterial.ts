import { FrontSide, MeshBasicMaterial, type Texture } from 'three';

/**
 * No custom shader for clouds. The pipeline already bakes the cloud WebP as
 * flat-white RGB with luminance moved into alpha, so an unlit basic material
 * with `transparent` draws exactly the right thing.
 */
export function createCloudMaterial(map: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map,
    transparent: true,
    // A transparent shell must not write depth, or its own back-facing
    // fragments and later transparent layers (atmosphere) get occluded.
    depthWrite: false,
    side: FrontSide,
  });
}
