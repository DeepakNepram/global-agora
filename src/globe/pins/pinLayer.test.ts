import {
  DataTexture,
  InstancedMesh,
  InterleavedBufferAttribute,
  ShaderMaterial,
  type BufferGeometry,
} from 'three';
import { describe, expect, it } from 'vitest';

import {
  createNodeBuffer,
  fillMockNodes,
  unclusteredLayout,
  PETAL_LEVEL,
  type NodeBuffer,
} from '@/core';
import { FIXTURE_EPOCH_SEC, stack, storyBuffer } from '@/core/cluster/cluster.fixture';
import { clusterColumns } from '@/core/cluster/clusterClient';
import { createClusterEngine } from '@/core/cluster/engine';

import { BLOOM_TWIST_RAD, bloomSeconds } from './bloom';
import { createPinLayer, type PinLayer } from './pinLayer';
import { PIN_OFFSET, PIN_STRIDE } from './pinInstances';
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

function showAll(layer: PinLayer, nodes: NodeBuffer): void {
  layer.present(nodes, unclusteredLayout(nodes, WINDOW_END_MS / 1000));
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

function uniform(layer: PinLayer, name: string): unknown {
  const material = onlyMesh(layer).material;
  if (!(material instanceof ShaderMaterial)) throw new Error('expected a ShaderMaterial');
  return material.uniforms[name]?.value;
}

describe('createPinLayer', () => {
  it('draws every pin with exactly one InstancedMesh', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    showAll(layer, mockNodes(3000));
    expect(instancedMeshes(layer)).toHaveLength(1);
    expect(onlyMesh(layer).count).toBe(3000);
    expect(onlyMesh(layer).frustumCulled).toBe(false);
  });

  it('stores all five vec4 slot attributes in one interleaved buffer', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    const geometry: BufferGeometry = onlyMesh(layer).geometry;
    const names = ['aInner', 'aOuter', 'aOffsets', 'aSpring', 'aPulse'];
    const buffers = new Set(
      names.map((name) => {
        const attribute = geometry.getAttribute(name);
        expect(attribute).toBeInstanceOf(InterleavedBufferAttribute);
        expect(attribute.itemSize).toBe(4);
        return (attribute as InterleavedBufferAttribute).data;
      }),
    );
    expect(buffers.size).toBe(1);
    expect([...buffers][0]?.stride).toBe(PIN_STRIDE);
  });

  it('rewrites the same array on every change and uploads only the slots in use', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    const attribute = onlyMesh(layer).geometry.getAttribute('aInner') as InterleavedBufferAttribute;
    const array = attribute.data.array;
    const version = attribute.data.version;

    showAll(layer, mockNodes(3000));
    expect(attribute.data.array).toBe(array);
    expect(attribute.data.version).toBe(version + 1);
    expect(attribute.data.updateRanges).toEqual([{ start: 0, count: 3000 * PIN_STRIDE }]);
  });

  it('moves only a uniform while the displayed time moves, and retimes pulses once it rests', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    const mesh = onlyMesh(layer);
    const attribute = mesh.geometry.getAttribute('aInner') as InterleavedBufferAttribute;
    const uNow = (mesh.material as ShaderMaterial).uniforms.uNow;
    showAll(layer, mockNodes(3000));
    const version = attribute.data.version;

    // A minute of story time per frame for a second: a drag.
    for (let frame = 1; frame <= 60; frame++) {
      layer.setTime(WINDOW_END_MS - frame * 60_000);
      layer.advance(1 / 60);
    }
    expect(attribute.data.version).toBe(version);
    expect(uNow?.value).toBe(-3600);

    for (let frame = 0; frame < 20; frame++) layer.advance(1 / 60);
    expect(attribute.data.version).toBe(version + 1);
  });

  it('grows by replacing its mesh, so there is still one, and disposes the old', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS, capacity: 1000 });
    expect(layer.capacity).toBe(1024);
    const small = onlyMesh(layer);
    let disposed = false;
    small.addEventListener('dispose', () => {
      disposed = true;
    });

    showAll(layer, mockNodes(3000));
    expect(layer.capacity).toBe(4096);
    expect(onlyMesh(layer)).not.toBe(small);
    expect(onlyMesh(layer).count).toBe(3000);
    expect(disposed).toBe(true);
  });

  it('asks for frames only while pins pulse or springs move', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    expect(layer.advance(1 / 60)).toBe(false);

    showAll(layer, mockNodes(100));
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

  it('plays a bloom to the end from its first frame, then stops asking for frames', () => {
    const now = FIXTURE_EPOCH_SEC + 3600;
    const nodes = storyBuffer(stack(120, 38.9, -77.04, 1));
    const engine = createClusterEngine();
    engine.load(1, clusterColumns(nodes));
    const layer = createPinLayer({ timeMs: FIXTURE_EPOCH_SEC * 1000 - 1 });
    layer.setVisible(false); // no pulse: only the springs keep it drawing

    expect(layer.present(nodes, engine.layout(1, 8, now)).durationMs).toBe(0);
    const bloom = layer.present(nodes, engine.layout(1, PETAL_LEVEL, now));
    expect(bloom.moving).toBe(120);
    expect(bloom.durationMs).toBeCloseTo(bloomSeconds(120) * 1000, 3);
    expect(bloom.durationMs).toBeLessThan(600);

    // An idle gap of seconds before the first frame must not skip the bloom.
    layer.advance(4);
    expect(layer.animationRemainingMs()).toBeGreaterThan(bloom.durationMs - 20);
    let frames = 0;
    while (layer.advance(1 / 60)) frames++;
    expect(frames).toBeGreaterThan(30);
    expect(frames).toBeLessThanOrEqual(36);
    expect(layer.animationRemainingMs()).toBe(0);
  });

  it('lands a bloom at once under reduced motion, and cuts one short when it is switched on', () => {
    const now = FIXTURE_EPOCH_SEC + 3600;
    const nodes = storyBuffer(stack(10, 0, 0, 1));
    const engine = createClusterEngine();
    engine.load(1, clusterColumns(nodes));
    const layer = createPinLayer({ timeMs: now * 1000 });
    layer.present(nodes, engine.layout(1, 8, now));
    expect(layer.present(nodes, engine.layout(1, PETAL_LEVEL, now)).durationMs).toBeGreaterThan(0);
    layer.setMotion('reduced');
    expect(layer.animationRemainingMs()).toBe(0);
    expect(layer.present(nodes, engine.layout(1, 8, now)).durationMs).toBe(0);
  });

  it('blooms clusters open when the time starts to move and folds them back along the same paths', () => {
    const now = FIXTURE_EPOCH_SEC + 3600;
    // Two stacks a little apart: one orb each at level 2, every story its own pin when open.
    const nodes = storyBuffer([...stack(6, 10, 10, 1), ...stack(6, 10.5, 10.5, 101)]);
    const engine = createClusterEngine();
    engine.load(1, clusterColumns(nodes));
    const layer = createPinLayer({ timeMs: now * 1000 });
    const array = onlyMesh(layer).geometry.getAttribute('aInner') as InterleavedBufferAttribute;
    const twist = (slot: number): number =>
      (array.data.array as Float32Array)[slot * PIN_STRIDE + PIN_OFFSET.twist] ?? NaN;
    layer.setVisible(false);

    layer.present(nodes, engine.layout(1, 2, now));
    const open = layer.present(nodes, engine.layout(1, 2, now, true));
    expect(open.moving).toBe(12);
    // Every child spirals out, like a zoom in: the orb's own slot included.
    for (let slot = 0; slot < 12; slot++) expect(twist(slot)).toBeCloseTo(BLOOM_TWIST_RAD, 6);
    expect(open.durationMs).toBeLessThan(600);

    while (layer.advance(1 / 60));
    const close = layer.present(nodes, engine.layout(1, 2, now));
    expect(close.moving).toBe(12);
    // Reversed along the spiral it came out on, not a new path.
    for (let slot = 0; slot < 12; slot++) expect(twist(slot)).toBeCloseTo(BLOOM_TWIST_RAD, 6);
  });

  it('draws a count only once the host hands it the glyphs', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    expect(uniform(layer, 'uHasBadges')).toBe(0);
    const atlas = new DataTexture(new Uint8Array(4), 1, 1);
    layer.setBadgeAtlas(atlas);
    expect(uniform(layer, 'uHasBadges')).toBe(1);
    expect(uniform(layer, 'uBadgeAtlas')).toBe(atlas);
  });

  it('rebases its clock before float32 precision could show', () => {
    const layer = createPinLayer({ timeMs: WINDOW_END_MS });
    showAll(layer, mockNodes(100));
    let steps = 0;
    let highest = 0;
    while (steps++ < 5000) {
      layer.advance(0.25);
      highest = Math.max(highest, Number(uniform(layer, 'uTime')));
    }
    // 1250 s of pulse: without a rebase the clock would read 1250.
    expect(highest).toBeLessThanOrEqual(PULSE_CLOCK_REBASE_SECONDS + 0.25);
    expect(Number(uniform(layer, 'uTime'))).toBeGreaterThanOrEqual(0);
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
