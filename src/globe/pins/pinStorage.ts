import type { Group, ShaderMaterial } from 'three';

import {
  createPinMesh,
  disposePinMesh,
  nextPowerOfTwo,
  type PinMesh,
  type PinUniforms,
} from './pinMesh';

/**
 * The pin layer's one InstancedMesh and the per-slot table that goes with it.
 * Growing replaces the mesh, never adds one, so there is still exactly one
 * InstancedMesh (CLAUDE.md constraint 2); the slots carry over as they are,
 * animations and all.
 */
export interface PinStorage {
  readonly pins: PinMesh;
  /** Per slot, the slot of the cluster it last belonged to (transitions.ts); −1 for none. */
  readonly groupSlot: Int32Array;
  /** Grows to hold `needed` slots, in powers of two so growth is rare. */
  ensureCapacity(needed: number): void;
  dispose(): void;
}

export function createPinStorage(
  parent: Group,
  material: ShaderMaterial,
  uniforms: PinUniforms,
  capacity: number,
): PinStorage {
  const attach = (slots: number): PinMesh => {
    const built = createPinMesh(slots, material);
    // The horizon test runs in the Earth-fixed frame, so the camera must too.
    built.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      built.mesh.worldToLocal(
        uniforms.uCameraLocal.value.setFromMatrixPosition(camera.matrixWorld),
      );
    };
    parent.add(built.mesh);
    return built;
  };

  let pins = attach(nextPowerOfTwo(capacity));
  let groupSlot = new Int32Array(pins.buffer.count).fill(-1);

  return {
    get pins() {
      return pins;
    },

    get groupSlot() {
      return groupSlot;
    },

    ensureCapacity(needed) {
      if (needed <= pins.buffer.count) return;
      const previous = pins;
      pins = attach(nextPowerOfTwo(needed));
      pins.array.set(previous.array);
      pins.orbMatch.array.set(previous.orbMatch.array);
      disposePinMesh(previous);
      const groups = new Int32Array(pins.buffer.count).fill(-1);
      groups.set(groupSlot);
      groupSlot = groups;
    },

    dispose() {
      disposePinMesh(pins);
    },
  };
}
