import { useEffect, useMemo, useRef, type RefObject } from 'react';

import type { ClusterLayout, NodeBuffer, QualityTier } from '@/core';
import { filterStore, ringedStory, storyStore, timeStore } from '@/state';

import { placeRing } from '../globe/focusRing';
import type { PinPicker } from '../globe/pinPicker';
import type { FocusedPin } from '../globe/usePinFocus';
import { drawFlatMap } from './drawFlatMap';
import type { FlatControls } from './flatCamera';
import { flatDimming, ringedRow, type FlatDrawn } from './flatPicking';
import { useMapAssets } from './useMapAssets';

/** What changes from render to render, read by the draw through a ref. */
export interface FlatLive {
  readonly nodes: NodeBuffer | null;
  readonly paused: boolean;
  readonly focused: FocusedPin | null;
}

export interface FlatDraw {
  /** Asks for one frame; any number of calls before it is drawn make one. */
  requestDraw(): void;
  /** What is drawn now, for picking; null before the first layout. */
  drawn(): FlatDrawn | null;
}

export interface FlatDrawOptions {
  readonly tier: QualityTier;
  readonly controls: FlatControls;
  readonly canvas: RefObject<HTMLCanvasElement | null>;
  readonly ring: RefObject<HTMLDivElement | null>;
  readonly picker: PinPicker;
  readonly layout: RefObject<ClusterLayout | null>;
  readonly live: FlatLive;
}

/** Device pixels per CSS pixel, capped like the globe's (GlobeCanvas DPR_RANGE). */
function pixelRatio(): number {
  return Math.min(2, Math.max(1, window.devicePixelRatio || 1));
}

/**
 * The flat map's render on demand: a frame when the view, the time, the
 * filters, the open story, the stories, the texture or the font change,
 * never otherwise, and the keyboard's focus ring placed after each.
 */
export function useFlatDraw(options: FlatDrawOptions): FlatDraw {
  const { tier, controls, canvas, ring, picker, layout } = options;
  const live = useRef(options.live);
  const frameRequest = useRef(0);
  const font = useRef('sans-serif');
  const textureRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    live.current = options.live;
  });

  const draw = useMemo((): FlatDraw => {
    const drawn = (): FlatDrawn | null => {
      const stories = live.current.nodes;
      const shown = layout.current;
      if (!stories || !shown) return null;
      return {
        nodes: stories,
        layout: shown,
        view: controls.view(),
        size: controls.size(),
        nowSec: timeStore.getState().timeMs / 1000,
        filter: filterStore.getState().filter,
      };
    };
    const render = (): void => {
      frameRequest.current = 0;
      const element = canvas.current;
      const context = element?.getContext('2d');
      const size = controls.size();
      if (!element || !context || size.width === 0 || live.current.paused) return;
      const ratio = pixelRatio();
      const width = Math.round(size.width * ratio);
      const height = Math.round(size.height * ratio);
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }
      const scene = drawn();
      drawFlatMap(context, {
        view: controls.view(),
        size,
        ratio,
        texture: textureRef.current,
        nodes: scene?.nodes ?? null,
        layout: scene?.layout ?? null,
        nowSec: timeStore.getState().timeMs / 1000,
        dimmed: (scene && flatDimming(scene)) ?? (() => false),
        ringed: scene
          ? ringedRow(scene.nodes, scene.layout, ringedStory(storyStore.getState()))
          : -1,
        fontFamily: font.current,
      });
      const pin = live.current.focused;
      if (pin) placeRing(ring.current, picker.locate(pin.target.row));
    };
    return {
      requestDraw: () => {
        if (frameRequest.current === 0) frameRequest.current = window.requestAnimationFrame(render);
      },
      drawn,
    };
  }, [controls, canvas, ring, picker, layout]);

  const texture = useMapAssets(tier, canvas, font, draw.requestDraw);

  useEffect(() => {
    textureRef.current = texture;
    draw.requestDraw();
  }, [texture, draw]);

  // The time, the filters and the open story all change what is drawn.
  useEffect(() => {
    const { requestDraw } = draw;
    const unsubscribe = [
      timeStore.subscribe((now, before) => {
        if (now.timeMs !== before.timeMs) requestDraw();
      }),
      filterStore.subscribe(requestDraw),
      storyStore.subscribe((now, before) => {
        if (ringedStory(now) !== ringedStory(before)) requestDraw();
      }),
    ];
    return () => unsubscribe.forEach((stop) => stop());
  }, [draw]);

  const { nodes, paused, focused } = options.live;
  useEffect(() => {
    draw.requestDraw();
  }, [nodes, paused, focused, draw]);

  // A 2D canvas can lose its pixels too (Chrome, under memory pressure); draw again once it is back.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const redraw = (): void => draw.requestDraw();
    element.addEventListener('contextrestored', redraw);
    return () => element.removeEventListener('contextrestored', redraw);
  }, [canvas, draw]);

  useEffect(
    () => () => {
      // Reset as well as cancel: StrictMode remounts, and a stale handle would block every draw.
      window.cancelAnimationFrame(frameRequest.current);
      frameRequest.current = 0;
    },
    [],
  );

  return draw;
}
