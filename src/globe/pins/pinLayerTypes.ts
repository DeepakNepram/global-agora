import type { Object3D, Texture } from 'three';

import type { ClusterLayout, NodeBuffer } from '@/core';

import type { MotionPreference } from '../camera/types';

/** The pin layer's public surface; createPinLayer (pinLayer.ts) implements it. */

export interface PinLayerOptions {
  /**
   * The instant the pins depict (epoch ms), required so the first frame shows
   * the right freshness. Also fixes the layer's time origin: publish times and
   * uNow count seconds from it, which float32 resolves to 1/128 s a day away.
   */
  readonly timeMs: number;
  /** Initial slot capacity; grows on demand. */
  readonly capacity?: number;
}

export interface PresentOptions {
  /** A different set of stories (dev pin sources): forget every slot and place without animating. */
  readonly reset?: boolean;
}

export interface PresentResult {
  /** Slots set moving. */
  readonly moving: number;
  /** Until the last of them settles, 0 when nothing moves. */
  readonly durationMs: number;
}

export interface PinLayer {
  /** Add this to the scene. Carries the axial tilt, like the Earth layer. */
  readonly object3d: Object3D;
  /** Slots that can be drawn without growing. */
  readonly capacity: number;
  /**
   * Shows `nodes` as `layout` arranges them. Slots are keyed by story id, so a
   * story present before keeps its slot, and every change animates from where
   * it is drawn now (instantly under reduced motion, and on the first call).
   */
  present(nodes: NodeBuffer, layout: ClusterLayout, options?: PresentOptions): PresentResult;
  /**
   * The displayed instant (epoch ms). Costs one uniform: the shader ages every
   * pin against it. Pulse rates catch up once the time rests.
   */
  setTime(timeMs: number): void;
  /** Drawing-buffer size and device pixel ratio, for constant on-screen size. */
  setViewport(bufferWidth: number, bufferHeight: number, pixelRatio: number): void;
  setMotion(motion: MotionPreference): void;
  setVisible(visible: boolean): void;
  /** The count glyphs (see badgeGlyphs.ts); null draws orbs without a count. The host owns it. */
  setBadgeAtlas(atlas: Texture | null): void;
  /** Milliseconds until every slot has settled; 0 when nothing moves. */
  animationRemainingMs(): number;
  /** Advances pulses and springs. Returns true while either moves, so the host keeps drawing. */
  advance(dtSeconds: number): boolean;
  dispose(): void;
}
