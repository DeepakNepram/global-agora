import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useState, type JSX } from 'react';

import type { NodeBuffer } from '@/core';
import { createPinLayer, type MotionPreference, type PinLayer } from '@/globe';
import { timeStore } from '@/state';

export interface PinSceneProps {
  /** The stories to draw (usePinNodes); null until the first payload arrives. */
  readonly nodes: NodeBuffer | null;
  readonly visible: boolean;
  readonly motion: MotionPreference;
}

/**
 * The r3f adapter for src/globe's pin layer: lifecycle, inputs and frame
 * scheduling only. While pins pulse, every frame asks for the next one, so the
 * globe draws at display rate; under reduced motion the pins hold still and
 * render-on-demand idles as before.
 */
export function PinScene({ nodes, visible, motion }: PinSceneProps): JSX.Element | null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const dpr = useThree((state) => state.viewport.dpr);
  const [layer, setLayer] = useState<PinLayer | null>(null);

  // Built and disposed inside one effect, like the Earth, for StrictMode.
  useEffect(() => {
    const created = createPinLayer({ timeMs: timeStore.getState().timeMs });
    setLayer(created);
    return () => {
      setLayer(null);
      created.dispose();
    };
  }, []);

  // Each payload is a new NodeBuffer, so this runs once per real change.
  useEffect(() => {
    if (!layer || !nodes) return;
    layer.updateInstances(nodes);
    invalidate();
  }, [layer, nodes, invalidate]);

  useEffect(() => {
    if (!layer) return;
    const show = (timeMs: number): void => {
      layer.setTime(timeMs);
      invalidate();
    };
    show(timeStore.getState().timeMs);
    // Outside React, like the sun: a scrub re-derives recency in one pass and
    // schedules one frame, with no re-render in between.
    return timeStore.subscribe((state, previous) => {
      if (state.timeMs !== previous.timeMs) show(state.timeMs);
    });
  }, [layer, invalidate]);

  useEffect(() => {
    if (!layer) return;
    // The composer renders at the drawing-buffer size, which is what the
    // shader's pixel maths needs; CSS size times dpr can differ by rounding.
    layer.setViewport(gl.domElement.width, gl.domElement.height, dpr);
    invalidate();
  }, [layer, gl, width, height, dpr, invalidate]);

  useEffect(() => {
    if (!layer) return;
    layer.setMotion(motion);
    invalidate();
  }, [layer, motion, invalidate]);

  useEffect(() => {
    if (!layer) return;
    layer.setVisible(visible);
    invalidate();
  }, [layer, visible, invalidate]);

  useFrame((_state, delta) => {
    if (layer?.advance(delta)) invalidate();
  });

  return layer ? <primitive object={layer.object3d} /> : null;
}
