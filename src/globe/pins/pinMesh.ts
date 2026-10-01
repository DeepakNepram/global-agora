import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DynamicDrawUsage,
  InstancedInterleavedBuffer,
  InstancedMesh,
  InterleavedBufferAttribute,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Texture,
} from 'three';

import { PIN_FRAG } from './pinFragment.glsl';
import { PIN_OFFSET, PIN_STRIDE } from './pinInstances';
import { CATEGORY_COLORS, PIN_HALF_SIZE_CSS_PX } from './pinStyle';
import { PIN_VERT } from './pinVertex.glsl';

/** The pin material's uniforms, shared by every mesh the layer builds. */
export interface PinUniforms {
  readonly uCameraLocal: { value: Vector3 };
  readonly uTime: { value: number };
  /** The displayed instant, seconds after the layer's time origin. */
  readonly uNow: { value: number };
  readonly uPulse: { value: number };
  readonly uViewport: { value: Vector2 };
  readonly uHalfSizePx: { value: number };
  readonly uPixelRatio: { value: number };
  readonly uPalette: { value: Float32Array };
  readonly uBadgeAtlas: { value: Texture | null };
  readonly uHasBadges: { value: number };
  /** Slot wearing the selection ring, or −1. */
  readonly uSelected: { value: number };
}

export function createPinUniforms(): PinUniforms {
  return {
    uCameraLocal: { value: new Vector3(0, 0, 4) },
    uTime: { value: 0 },
    uNow: { value: 0 },
    uPulse: { value: 1 },
    uViewport: { value: new Vector2(1, 1) },
    uHalfSizePx: { value: PIN_HALF_SIZE_CSS_PX },
    uPixelRatio: { value: 1 },
    uPalette: { value: CATEGORY_COLORS },
    uBadgeAtlas: { value: null },
    uHasBadges: { value: 0 },
    uSelected: { value: -1 },
  };
}

export function createPinMaterial(uniforms: PinUniforms): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: PIN_VERT,
    fragmentShader: PIN_FRAG,
    uniforms: { ...uniforms },
    transparent: true,
    // The globe is the only thing that can hide a pin, and the horizon test
    // does that exactly. Depth would clip halos against the globe and clouds.
    depthTest: false,
    depthWrite: false,
    // Premultiplied: halo pixels (alpha 0) add, dot pixels (alpha 1) cover.
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });
}

/** Four corners at ±1; the vertex shader scales them to pixels. */
function createQuadGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/** Capacities are powers of two, so growth is rare and never piecemeal. */
export function nextPowerOfTwo(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(n, 1)));
}

export interface PinMesh {
  readonly mesh: InstancedMesh;
  readonly buffer: InstancedInterleavedBuffer;
  /** The buffer's own array, typed: three declares it as any TypedArray. */
  readonly array: Float32Array;
}

/**
 * ONE InstancedMesh (CLAUDE.md constraint 2) with every per-slot value in one
 * interleaved Float32Array, so a transition is one pass and one upload.
 * instanceMatrix is left at identity and never read by the shader; each
 * slot's position comes from its path, because the quad is built in clip space.
 */
export function createPinMesh(capacity: number, material: ShaderMaterial): PinMesh {
  const geometry = createQuadGeometry();
  const array = new Float32Array(capacity * PIN_STRIDE);
  const buffer = new InstancedInterleavedBuffer(array, PIN_STRIDE);
  buffer.setUsage(DynamicDrawUsage);
  const view = (offset: number): InterleavedBufferAttribute =>
    new InterleavedBufferAttribute(buffer, 4, offset);
  geometry.setAttribute('aInner', view(PIN_OFFSET.inner));
  geometry.setAttribute('aOuter', view(PIN_OFFSET.outer));
  geometry.setAttribute('aOffsets', view(PIN_OFFSET.innerPx));
  geometry.setAttribute('aSpring', view(PIN_OFFSET.u0));
  geometry.setAttribute('aPulse', view(PIN_OFFSET.phase));

  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = 'pins';
  mesh.count = 0;
  // Pins cover the whole globe and cull themselves at the horizon; a bounding
  // sphere from the identity instance matrices would be wrong anyway.
  mesh.frustumCulled = false;
  // After the surface (0), clouds (1) and atmosphere (2).
  mesh.renderOrder = 3;
  return { mesh, buffer, array };
}

export function disposePinMesh({ mesh }: PinMesh): void {
  mesh.removeFromParent();
  mesh.geometry.dispose();
  mesh.dispose();
}

/** Marks the first `slots` slots for upload. */
export function uploadSlots({ buffer }: PinMesh, slots: number): void {
  buffer.clearUpdateRanges();
  buffer.addUpdateRange(0, slots * PIN_STRIDE);
  buffer.needsUpdate = true;
}
