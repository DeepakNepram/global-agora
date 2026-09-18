import {
  InstancedMesh,
  InterleavedBufferAttribute,
  ShaderMaterial,
  type BufferGeometry,
} from 'three';
import { describe, expect, it } from 'vitest';

import { createNodeBuffer, fillMockNodes, type NodeBuffer } from '@/core';

import { createPinLayer, type PinLayer } from './pinLayer';
import { PIN_STRIDE } from './pinInstances';
import { PULSE_CLOCK_REBASE_SECONDS } from './pinStyle';

const WINDOW_END_MS = Date.UTC(2026, 8, 17, 12, 0, 0);

function mockNodes(count: number): NodeBuffer {
  return fillMockNodes(createNodeBuffer(count), {
    count,
    windowEndMs: WINDOW_END_MS,
    windowHours: 24,
    seed: 3,
  });
}

function instancedMeshes(layer: PinLayer): InstancedMesh[] {
  const found: InstancedMesh[] = [];
  layer.object3d.traverse((object) => {
    if (object instanceof InstancedMesh) found.push(object);
  });
  return found;
}

function onlyMesh(layer: PinLayer): InstancedMesh {
  const [mesh, ...rest] = instancedMeshes(layer);
  if (!mesh || rest.length > 0) throw new Error('expected exactly one InstancedMesh');
  return mesh;
}

describe('createPinLayer', () => {
  it('draws every pin with exactly one InstancedMesh', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    layer.updateInstances(mockNodes(3000));
    expect(instancedMeshes(layer)).toHaveLength(1);
    expect(onlyMesh(layer).count).toBe(3000);
    expect(onlyMesh(layer).frustumCulled).toBe(false);
  });

  it('stores all eight instance attributes in one interleaved buffer', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    const geometry: BufferGeometry = onlyMesh(layer).geometry;
    const names = ['aCenter', 'aColor', 'aScale', 'aAlpha', 'aPhase', 'aRate', 'aRecency', 'aHot'];
    const buffers = new Set(
      names.map((name) => {
        const attribute = geometry.getAttribute(name);
        expect(attribute).toBeInstanceOf(InterleavedBufferAttribute);
        return (attribute as InterleavedBufferAttribute).data;
      }),
    );
    expect(buffers.size).toBe(1);
    expect([...buffers][0]?.stride).toBe(PIN_STRIDE);
  });

  it('rewrites the same array on every update and uploads only the live rows', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    const attribute = onlyMesh(layer).geometry.getAttribute(
      'aCenter',
    ) as InterleavedBufferAttribute;
    const array = attribute.data.array;
    const version = attribute.data.version;

    layer.updateInstances(mockNodes(3000));
    layer.setTime(WINDOW_END_MS - 3_600_000);
    expect(attribute.data.array).toBe(array);
    expect(attribute.data.version).toBe(version + 2);
    expect(attribute.data.updateRanges).toEqual([{ start: 0, count: 3000 * PIN_STRIDE }]);
  });

  it('grows by replacing its mesh, so there is still one, and disposes the old', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS, capacity: 1000 });
    expect(layer.capacity).toBe(1024);
    const small = onlyMesh(layer);
    let disposed = false;
    small.addEventListener('dispose', () => {
      disposed = true;
    });

    layer.updateInstances(mockNodes(3000));
    expect(layer.capacity).toBe(4096);
    expect(onlyMesh(layer)).not.toBe(small);
    expect(onlyMesh(layer).count).toBe(3000);
    expect(disposed).toBe(true);
  });

  it('asks for frames only while pins pulse', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    expect(layer.advance(1 / 60)).toBe(false);

    layer.updateInstances(mockNodes(100));
    expect(layer.advance(1 / 60)).toBe(true);

    layer.setMotion('reduced');
    expect(layer.advance(1 / 60)).toBe(false);
    layer.setMotion('full');

    layer.setVisible(false);
    expect(layer.advance(1 / 60)).toBe(false);
    layer.setVisible(true);

    // Every story is in the future at this instant, so nothing is on the globe.
    layer.setTime(WINDOW_END_MS - 25 * 3_600_000);
    expect(layer.advance(1 / 60)).toBe(false);
  });

  it('rebases the pulse clock before float32 precision could show', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    layer.updateInstances(mockNodes(100));
    const material = onlyMesh(layer).material;
    if (!(material instanceof ShaderMaterial)) throw new Error('expected a ShaderMaterial');
    const time = (): unknown => material.uniforms.uTime?.value;
    let steps = 0;
    let highest = 0;
    while (steps++ < 5000) {
      layer.advance(0.25);
      highest = Math.max(highest, Number(time()));
    }
    // 1250 s of pulse: without a rebase the clock would read 1250.
    expect(highest).toBeLessThanOrEqual(PULSE_CLOCK_REBASE_SECONDS + 0.25);
    expect(Number(time())).toBeGreaterThanOrEqual(0);
  });

  it('removes itself from the scene on dispose', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    const mesh = onlyMesh(layer);
    let disposed = false;
    mesh.addEventListener('dispose', () => {
      disposed = true;
    });
    layer.dispose();
    expect(disposed).toBe(true);
    expect(mesh.parent).toBeNull();
  });
});
