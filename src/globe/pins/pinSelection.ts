import { Vector3, type Camera, type Object3D } from 'three';

import { CLUSTER_ROLE, rowOfStory, type ClusterLayout, type NodeBuffer } from '@/core';

import type { ProjectPoint } from './pinPick';
import { horizonVisibility } from './pinStyle';

/**
 * The three.js half of picking and selection: projecting the pin layer's
 * Earth-fixed points through a camera, and finding the slot that wears the
 * selection ring. pinPick.ts stays free of three so it tests in plain numbers.
 */

/** A pin fading out at the limb is past this, and does not count as drawn. */
const PICKABLE_VISIBILITY = 0.5;

/**
 * Projects through `camera` the points of `frame` (the layer's tilt group:
 * anchors are in the Earth-fixed frame inside it) to CSS pixels of a
 * `width` × `height` viewport, skipping what the shader hides at the horizon.
 */
export function cameraProjection(
  frame: Object3D,
  camera: Camera,
  width: number,
  height: number,
): ProjectPoint {
  frame.updateWorldMatrix(true, false);
  camera.updateMatrixWorld();
  const eye = frame.worldToLocal(camera.getWorldPosition(new Vector3()));
  const v = new Vector3();
  return (x, y, z, out) => {
    if (horizonVisibility(x, y, z, eye.x, eye.y, eye.z) < PICKABLE_VISIBILITY) return false;
    v.set(x, y, z).applyMatrix4(frame.matrixWorld).project(camera);
    out.x = ((v.x + 1) / 2) * width;
    out.y = ((1 - v.y) / 2) * height;
    return true;
  };
}

/**
 * The slot drawing story `id`: its own pin or petal, or, while the story is
 * folded into a cluster, the orb holding it. −1 when it is not drawn.
 */
export function selectedSlot(
  nodes: NodeBuffer | null,
  layout: ClusterLayout | null,
  rowSlots: Int32Array,
  id: number | null,
): number {
  if (id === null || nodes === null || layout === null) return -1;
  const row = rowOfStory(nodes, id);
  if (row < 0 || row >= layout.count) return -1;
  const drawn = layout.roles[row] === CLUSTER_ROLE.hidden ? (layout.groups[row] ?? -1) : row;
  return drawn < 0 ? -1 : (rowSlots[drawn] ?? -1);
}
