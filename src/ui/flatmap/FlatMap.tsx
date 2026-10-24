import { useEffect, useRef, useState, type JSX } from 'react';

import {
  unclusteredLayout,
  type ClusterLayout,
  type NodeBuffer,
  type Permalink,
  type QualityTier,
} from '@/core';
import { clusterZoomFor, nextClusterLevel } from '@/globe';
import { onboardingStore, timeStore, useDiscussionStage } from '@/state';

import { setViewFocus } from '../focus/viewFocus';
import type { GlobeInputHandlers } from '../globe/bindControlInput';
import { GlobeReticle } from '../globe/GlobeReticle';
import { PinFocusRing } from '../globe/PinFocusRing';
import type { PinPicker } from '../globe/pinPicker';
import { useClusterFeed } from '../globe/useClusterFeed';
import type { FocusedPin } from '../globe/usePinFocus';
import { bindMapInput } from './bindMapInput';
import { altitudeForScale, createFlatControls, type FlatControls } from './flatCamera';
import { flatPinSource } from './flatPicking';
import { useFlatDraw } from './useFlatDraw';

export interface FlatMapProps {
  readonly tier: QualityTier;
  readonly nodes: NodeBuffer | null;
  /** Dev: off draws every story as its own pin. */
  readonly clustering: boolean;
  readonly picker: PinPicker;
  readonly input: GlobeInputHandlers;
  readonly message: string;
  readonly focused: FocusedPin | null;
  /** The shared view this page was opened with, if any. */
  readonly link: Permalink;
  readonly onCamera: (camera: FlatControls | null) => void;
  /** The list is showing: the map keeps its view but draws nothing and takes no input. */
  readonly paused: boolean;
  /** A modal sheet is up over it: no input. */
  readonly covered: boolean;
}

const MAP_LABEL =
  'Flat map of the world with news stories as pins, shown because this device asks for reduced ' +
  'motion. Drag to move it, scroll or pinch to zoom, tap a pin to read its story. When focused, ' +
  'Tab goes through the pins in view, nearest the centre first, and Enter opens the one with the ' +
  'ring; arrow keys move the map, plus or minus zoom, and Home returns to the whole world. The ' +
  'list view shows every story as a list.';

/**
 * The flat map that stands in for the globe under reduced motion (Prompt
 * 5.1): the same stories, clusters, filters, time and keyboard, on a 2D
 * canvas drawn only when something changes (useFlatDraw). Nothing on it
 * moves by itself: no flights, no inertia, no pulse, no bloom.
 */
export function FlatMap(props: FlatMapProps): JSX.Element {
  const { tier, nodes, clustering, picker, focused, paused, onCamera } = props;
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [controls] = useState(() =>
    createFlatControls(props.link.camera, onboardingStore.getState().homeCity),
  );
  const layoutRef = useRef<ClusterLayout | null>(null);
  const levelRef = useRef<number | null>(null);
  const inputRef = useRef(props.input);
  const pausedRef = useRef(paused);
  const inDiscussion = useDiscussionStage((stage) => stage.phase !== 'closed');
  const { requestDraw, drawn } = useFlatDraw({
    tier,
    controls,
    canvas,
    ring,
    picker,
    layout: layoutRef,
    live: { nodes, paused, focused },
  });

  useEffect(() => {
    inputRef.current = props.input;
    pausedRef.current = paused;
  });

  // The camera the search, the sheets and Share use while the map shows.
  useEffect(() => {
    onCamera(controls);
    return () => onCamera(null);
  }, [controls, onCamera]);

  useEffect(() => {
    picker.attach(flatPinSource(drawn, () => controls.size()));
    return () => picker.attach(null);
  }, [picker, drawn, controls]);

  // Closing a story's sheet hands focus back to the map.
  useEffect(() => setViewFocus(() => (pausedRef.current ? null : frame.current)), []);

  const feed = useClusterFeed({
    nodes: clustering ? nodes : null,
    initialLevel: 0,
    onLayout: (_shown, layout) => {
      layoutRef.current = layout;
      requestDraw();
    },
  });

  useEffect(() => {
    if (!nodes || (clustering && !feed.failed)) return;
    layoutRef.current = unclusteredLayout(nodes, timeStore.getState().timeMs / 1000);
    requestDraw();
  }, [nodes, clustering, feed.failed, requestDraw]);

  // Every change of view: a new frame, and the cluster level the globe would show from this height.
  useEffect(() => {
    const onView = (): void => {
      const size = controls.size();
      const altitudeKm = altitudeForScale(controls.view().scale, size.height);
      const level = nextClusterLevel(levelRef.current, clusterZoomFor(altitudeKm, size.height));
      if (level !== levelRef.current) {
        levelRef.current = level;
        feed.setLevel(level);
      }
      requestDraw();
    };
    onView();
    return controls.onChange(onView);
  }, [controls, feed, requestDraw]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        controls.setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [controls]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    // Through the ref, so new handlers never re-bind (and reset) a gesture.
    return bindMapInput(element, controls, {
      onTap: (x, y) => inputRef.current.onTap(x, y),
      onActivate: (x, y) => inputRef.current.onActivate(x, y),
      onEscape: () => inputRef.current.onEscape(),
      onHome: () => inputRef.current.onHome(),
      onTab: (target, backward) => inputRef.current.onTab(target, backward),
      onBlur: () => inputRef.current.onBlur(),
    });
  }, [controls]);

  return (
    <div className={`absolute inset-0 ${paused ? 'invisible' : ''}`}>
      <div
        ref={frame}
        role="application"
        aria-roledescription="map"
        aria-label={MAP_LABEL}
        tabIndex={0}
        // Behind the discussion panel, or under the list, the map takes no input.
        inert={inDiscussion || paused || props.covered}
        className="peer absolute inset-0 cursor-grab touch-none select-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      </div>
      {/* After the map: they show on its focus-visible (CSS peer). */}
      <GlobeReticle message={props.message} pinFocused={focused !== null} />
      <PinFocusRing ring={ring} focused={focused} />
    </div>
  );
}
