import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DynamicDrawUsage,
  Group,
  InstancedInterleavedBuffer,
  InstancedMesh,
  InterleavedBufferAttribute,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';

import type { NodeBuffer } from '@/core';

import type { MotionPreference } from '../camera/types';
import { earthTiltQuaternion } from '../views';
import {
  PIN_OFFSET,
  PIN_STRIDE,
  rebasePulseClock,
  writeInstances,
  type InstanceWrite,
} from './pinInstances';
import { PIN_FRAG, PIN_VERT } from './pins.glsl';
import { PIN_HALF_SIZE_CSS_PX, PULSE_CLOCK_REBASE_SECONDS } from './pinStyle';

/** Enough for the 3000-story target without growing. */
const DEFAULT_CAPACITY = 4096;

/** A step longer than this is a resumed tab, not motion; see earth.ts. */
const MAX_STEP_SECONDS = 0.25;

export interface PinLayerOptions {
  /**
   * The instant the pins depict (epoch ms), required so the first frame shows
   * the right recency rather than a placeholder one.
   */
  readonly timeMs: number;
  /** Initial instance capacity; grows on demand. */
  readonly capacity?: number;
}

export interface PinLayer {
  /** Add this to the scene. Carries the axial tilt, like the Earth layer. */
  readonly object3d: Object3D;
  /** Pins that can be drawn without growing. */
  readonly capacity: number;
  /** Writes every node's attributes in one pass and uploads them once. */
  updateInstances(nodes: NodeBuffer): void;
  /** The displayed instant (epoch ms). Re-derives recency for the current nodes. */
  setTime(timeMs: number): void;
  /** Drawing-buffer size and device pixel ratio, for constant on-screen size. */
  setViewport(bufferWidth: number, bufferHeight: number, pixelRatio: number): void;
  setMotion(motion: MotionPreference): void;
  setVisible(visible: boolean): void;
  /** Advances the pulse. Returns true while pins pulse, so the host keeps drawing. */
  advance(dtSeconds: number): boolean;
  dispose(): void;
}

function nextPowerOfTwo(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(n, 1)));
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

interface PinMesh {
  readonly mesh: InstancedMesh;
  readonly buffer: InstancedInterleavedBuffer;
  /** The buffer's own array, typed: three declares it as any TypedArray. */
  readonly array: Float32Array;
}

/**
 * The news pins: ONE InstancedMesh (CLAUDE.md constraint 2), with every
 * per-pin value in one interleaved Float32Array so an update is one pass and
 * one upload.
 *
 *   tilt           quaternion = 23.44° about X (same as the Earth)
 *    └─ pins       InstancedMesh, quad × count, renderOrder 3
 *
 * instanceMatrix is left at identity and never read by the shader; the pin
 * position is its own attribute because the quad is built in clip space.
 */
export function createPinLayer(options: PinLayerOptions): PinLayer {
  const uniforms = {
    uCameraLocal: { value: new Vector3(0, 0, 4) },
    uTime: { value: 0 },
    uPulse: { value: 1 },
    uViewport: { value: new Vector2(1, 1) },
    uHalfSizePx: { value: PIN_HALF_SIZE_CSS_PX },
  };

  const material = new ShaderMaterial({
    vertexShader: PIN_VERT,
    fragmentShader: PIN_FRAG,
    uniforms,
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

  const tilt = new Group();
  tilt.name = 'pins-tilt';
  earthTiltQuaternion(tilt.quaternion);

  const buildMesh = (capacity: number): PinMesh => {
    const geometry = createQuadGeometry();
    const array = new Float32Array(capacity * PIN_STRIDE);
    const buffer = new InstancedInterleavedBuffer(array, PIN_STRIDE);
    buffer.setUsage(DynamicDrawUsage);
    const view = (size: number, offset: number): InterleavedBufferAttribute =>
      new InterleavedBufferAttribute(buffer, size, offset);
    geometry.setAttribute('aCenter', view(3, PIN_OFFSET.center));
    geometry.setAttribute('aColor', view(3, PIN_OFFSET.color));
    geometry.setAttribute('aScale', view(1, PIN_OFFSET.scale));
    geometry.setAttribute('aAlpha', view(1, PIN_OFFSET.alpha));
    geometry.setAttribute('aPhase', view(1, PIN_OFFSET.phase));
    geometry.setAttribute('aRate', view(1, PIN_OFFSET.rate));
    geometry.setAttribute('aRecency', view(1, PIN_OFFSET.recency));
    geometry.setAttribute('aHot', view(1, PIN_OFFSET.hot));

    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = 'pins';
    mesh.count = 0;
    // Pins cover the whole globe and cull themselves at the horizon; a bounding
    // sphere from the identity instance matrices would be wrong anyway.
    mesh.frustumCulled = false;
    // After the surface (0), clouds (1) and atmosphere (2).
    mesh.renderOrder = 3;
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      mesh.worldToLocal(uniforms.uCameraLocal.value.setFromMatrixPosition(camera.matrixWorld));
    };
    tilt.add(mesh);
    return { mesh, buffer, array };
  };

  const disposeMesh = ({ mesh }: PinMesh): void => {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    mesh.dispose();
  };

  let pins = buildMesh(nextPowerOfTwo(options.capacity ?? DEFAULT_CAPACITY));
  let nodes: NodeBuffer | null = null;
  let nowSeconds = options.timeMs / 1000;
  let clock = 0;
  let visibleCount = 0;
  let pulseEnabled = true;

  const write = (mode: InstanceWrite): void => {
    if (!nodes) return;
    const { buffer, mesh, array } = pins;
    visibleCount = writeInstances(nodes, array, nowSeconds, clock, mode);
    buffer.clearUpdateRanges();
    buffer.addUpdateRange(0, nodes.count * PIN_STRIDE);
    buffer.needsUpdate = true;
    mesh.count = nodes.count;
  };

  return {
    object3d: tilt,

    get capacity() {
      return pins.buffer.count;
    },

    updateInstances(next) {
      if (next.count > pins.buffer.count) {
        // Rare (the payload outgrew the estimate): replace, never add, so there
        // is still exactly one InstancedMesh.
        disposeMesh(pins);
        pins = buildMesh(nextPowerOfTwo(next.count));
      }
      nodes = next;
      write('replace');
    },

    setTime(timeMs) {
      if (!Number.isFinite(timeMs)) return;
      nowSeconds = timeMs / 1000;
      write('retime');
    },

    setViewport(bufferWidth, bufferHeight, pixelRatio) {
      uniforms.uViewport.value.set(Math.max(1, bufferWidth), Math.max(1, bufferHeight));
      uniforms.uHalfSizePx.value = PIN_HALF_SIZE_CSS_PX * pixelRatio;
    },

    setMotion(motion) {
      pulseEnabled = motion === 'full';
      uniforms.uPulse.value = pulseEnabled ? 1 : 0;
    },

    setVisible(visible) {
      tilt.visible = visible;
    },

    advance(dtSeconds) {
      if (!pulseEnabled || !tilt.visible || visibleCount === 0 || !(dtSeconds > 0)) return false;
      clock += Math.min(dtSeconds, MAX_STEP_SECONDS);
      if (clock > PULSE_CLOCK_REBASE_SECONDS && nodes) {
        const { buffer, array } = pins;
        clock = rebasePulseClock(array, nodes.count, clock, clock);
        buffer.clearUpdateRanges();
        buffer.addUpdateRange(0, nodes.count * PIN_STRIDE);
        buffer.needsUpdate = true;
      }
      uniforms.uTime.value = clock;
      return true;
    },

    dispose() {
      tilt.removeFromParent();
      disposeMesh(pins);
      material.dispose();
    },
  };
}
