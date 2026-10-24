import type { Camera, Object3D } from 'three';

import type { ClusterLayout, NodeBuffer } from '@/core';

import type { PickViewport, PinLayer, TargetBounds } from './pinLayerTypes';
import { drawnTargets, locateRow, pickPin, type PickInput } from './pinPick';
import { cameraProjection } from './pinSelection';

/** What the pin layer has drawn, as picking needs it; null before the first layout. */
export interface DrawnState {
  readonly nodes: NodeBuffer;
  readonly layout: ClusterLayout;
  readonly nowSeconds: number;
}

type Picking = Pick<PinLayer, 'pick' | 'targets' | 'locate'>;

/**
 * The pin layer's three questions about what is on screen: what is under a
 * tap, what Tab can visit (Prompt 5.1), and where one row is drawn now (for
 * the keyboard's focus ring). All three project the last layout through the
 * camera on the CPU; see pinPick.ts.
 */
export function createPinPicking(
  frame: Object3D,
  drawn: () => DrawnState | null,
  dimmed: (state: DrawnState, row: number) => boolean,
): Picking {
  const input = (camera: Camera, viewport: PickViewport): Omit<PickInput, 'x' | 'y'> | null => {
    const state = frame.visible ? drawn() : null;
    if (!state) return null;
    return {
      nodes: state.nodes,
      layout: state.layout,
      nowSec: state.nowSeconds,
      project: cameraProjection(frame, camera, viewport.width, viewport.height),
      dimmed: (row) => dimmed(state, row),
    };
  };

  return {
    pick(x, y, camera, viewport, radiusPx) {
      const base = input(camera, viewport);
      if (!base) return null;
      return pickPin({ ...base, x, y, ...(radiusPx === undefined ? {} : { radiusPx }) });
    },
    targets(camera, viewport, bounds?: TargetBounds) {
      const base = input(camera, viewport);
      if (!base) return [];
      return drawnTargets(
        base,
        bounds ?? { left: 0, top: 0, right: viewport.width, bottom: viewport.height },
      );
    },
    locate(row, camera, viewport) {
      const base = input(camera, viewport);
      return base ? locateRow(base, row) : null;
    },
  };
}
