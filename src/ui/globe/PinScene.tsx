import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { PerspectiveCamera } from 'three';

import { unclusteredLayout, type ClusterLayout, type NodeBuffer } from '@/core';
import {
  altitudeKmAt,
  clusterZoomFor,
  createPinLayer,
  fitAltitudeKm,
  nextClusterLevel,
  type MotionPreference,
  type PinLayer,
  type PresentResult,
} from '@/globe';
import { monotonicNowMs, ringedStory, storyStore, timeStore } from '@/state';

import { createBadgeAtlas } from './badgeAtlas';
import type { PinPicker } from './pinPicker';
import { useClusterFeed } from './useClusterFeed';

export interface PresentReport extends PresentResult {
  readonly level: number;
  /** Main-thread time to plan the transition and write the slots, ms. */
  readonly planMs: number;
  /** monotonicNowMs() when it was presented. */
  readonly atMs: number;
}

export interface PinSceneProps {
  /** The stories to draw (usePinNodes); null until the first payload arrives. */
  readonly nodes: NodeBuffer | null;
  /** Which stories these are ('live', a mock load): a change forgets every slot. */
  readonly sourceKey: string;
  readonly visible: boolean;
  readonly motion: MotionPreference;
  /** Off draws every story as its own pin, as the 1.5 pin benchmark measures. */
  readonly clustering: boolean;
  /** Dev tooling: told about every layout presented. */
  readonly onPresent?: (report: PresentReport) => void;
  /** Receives the layer's pick function, for taps outside the canvas. */
  readonly picker?: PinPicker;
}

/**
 * The r3f adapter for src/globe's pin layer: lifecycle, inputs and frame
 * scheduling. Each frame it works out the cluster level the camera is at and,
 * when that changes, asks the clustering worker for the new layout; layouts
 * come back asynchronously and the layer animates to them. While pins pulse
 * or springs move, every frame asks for the next one; otherwise
 * render-on-demand idles as before.
 */
export function PinScene(props: PinSceneProps): JSX.Element | null {
  const { nodes, sourceKey, visible, motion, clustering, onPresent, picker } = props;
  const gl = useThree((state) => state.gl);
  const get = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const dpr = useThree((state) => state.viewport.dpr);
  const [layer, setLayer] = useState<PinLayer | null>(null);
  const levelRef = useRef<number | null>(null);
  const sources = useRef(new WeakMap<NodeBuffer, string>());
  const presentedSource = useRef<string | null>(null);
  const onPresentRef = useRef(onPresent);

  // Built and disposed inside one effect, like the Earth, for StrictMode.
  useEffect(() => {
    const created = createPinLayer({ timeMs: timeStore.getState().timeMs });
    setLayer(created);
    return () => {
      setLayer(null);
      created.dispose();
    };
  }, []);

  useEffect(() => {
    onPresentRef.current = onPresent;
  }, [onPresent]);

  useEffect(() => {
    if (nodes) sources.current.set(nodes, sourceKey);
  }, [nodes, sourceKey]);

  const present = useCallback(
    (shown: NodeBuffer, layout: ClusterLayout): void => {
      if (!layer) return;
      // Mock and live ids overlap, so a new source starts over rather than
      // animating one story into an unrelated one.
      const source = sources.current.get(shown) ?? null;
      const reset = presentedSource.current !== null && source !== presentedSource.current;
      presentedSource.current = source;
      const atMs = monotonicNowMs();
      const result = layer.present(shown, layout, { reset });
      onPresentRef.current?.({
        ...result,
        level: layout.level,
        planMs: monotonicNowMs() - atMs,
        atMs,
      });
      invalidate();
    },
    [layer, invalidate],
  );

  // The controls open on the world view, so the first question is asked about it.
  const initialLevel = nextClusterLevel(
    null,
    clusterZoomFor(fitAltitudeKm(width / Math.max(1, height)), height),
  );
  const feed = useClusterFeed({
    nodes: clustering && layer ? nodes : null,
    initialLevel,
    onLayout: present,
  });
  const unclustered = !clustering || feed.failed;

  useEffect(() => {
    if (!layer || !nodes || !unclustered) return;
    present(nodes, unclusteredLayout(nodes, timeStore.getState().timeMs / 1000));
  }, [layer, nodes, unclustered, present]);

  useEffect(() => {
    if (!layer) return;
    let current = createBadgeAtlas(getComputedStyle(document.body).fontFamily);
    layer.setBadgeAtlas(current);
    invalidate();
    // Redrawn once web fonts are in, so the counts use the app's own face.
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      const redrawn = createBadgeAtlas(getComputedStyle(document.body).fontFamily);
      layer.setBadgeAtlas(redrawn);
      current?.dispose();
      current = redrawn;
      invalidate();
    });
    return () => {
      cancelled = true;
      layer.setBadgeAtlas(null);
      current?.dispose();
    };
  }, [layer, invalidate]);

  useEffect(() => {
    if (!layer) return;
    const show = (timeMs: number): void => {
      layer.setTime(timeMs);
      invalidate();
    };
    show(timeStore.getState().timeMs);
    // Outside React, like the sun: a scrub moves one uniform and
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

  useEffect(() => {
    if (!layer || !picker) return;
    picker.attach(
      (x, y, radiusPx) => {
        const { camera, size } = get();
        const startMs = monotonicNowMs();
        const hit = layer.pick(x, y, camera, size, radiusPx);
        // Dev builds time each pick; DevTools shows it under User Timing.
        if (import.meta.env.DEV) {
          performance.measure('agora:pick', { start: startMs, end: monotonicNowMs() });
        }
        return hit;
      },
      () => get().size,
    );
    return () => picker.attach(null, null);
  }, [layer, picker, get]);

  useEffect(() => {
    if (!layer) return;
    const ring = (id: number | null): void => {
      layer.setSelected(id);
      invalidate();
    };
    ring(ringedStory(storyStore.getState()));
    return storyStore.subscribe((state, previous) => {
      const id = ringedStory(state);
      if (id !== ringedStory(previous)) ring(id);
    });
  }, [layer, invalidate]);

  useFrame((state, delta) => {
    // The camera always looks at the globe's centre, so its distance is its altitude.
    if (state.camera instanceof PerspectiveCamera) {
      const altitudeKm = altitudeKmAt(state.camera.position.length());
      const zoom = clusterZoomFor(altitudeKm, state.size.height, state.camera.fov);
      const level = nextClusterLevel(levelRef.current, zoom);
      if (level !== levelRef.current) {
        levelRef.current = level;
        feed.setLevel(level);
      }
    }
    if (layer?.advance(delta)) invalidate();
  });

  return layer ? <primitive object={layer.object3d} /> : null;
}
