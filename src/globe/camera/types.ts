import type { Quaternion, PerspectiveCamera } from 'three';

import type { LatLon } from '@/core';

import type { CameraPose } from './cameraMath';
import type { FlightResult } from './flight';
import type { PointerInput } from './pointerGestures';

export type ControlsMode = 'idle' | 'drag' | 'pinch' | 'inertia' | 'zoom' | 'flight';

export type MotionPreference = 'full' | 'reduced';

export interface WheelInput {
  /** Scroll distance in pixels; positive zooms out. */
  readonly deltaPx: number;
  readonly x: number;
  readonly y: number;
}

export interface FlyToOptions {
  /** Overrides the distance-based duration. */
  readonly durationMs?: number;
}

export interface AltitudeLimits {
  readonly minKm: number;
  readonly maxKm: number;
  /** World view for the current viewport. */
  readonly fitKm: number;
}

export interface ControlsTelemetry {
  readonly mode: ControlsMode;
  /** The inertia velocity being carried, as ground arc under the view centre. */
  readonly carriedDegPerSecond: number;
}

export interface OrbitGlobeControlsOptions {
  readonly camera: PerspectiveCamera;
  /** World orientation of the Earth-fixed frame: the globe's axial tilt. */
  readonly bodyOrientation?: Quaternion;
  readonly initialPose?: CameraPose;
  /** Asks the host to draw a frame. Render on demand: nothing else will. */
  readonly requestFrame?: () => void;
}

export interface OrbitGlobeControls {
  pointerDown(input: PointerInput): void;
  pointerMove(input: PointerInput): void;
  pointerUp(input: PointerInput): void;
  /** pointercancel or lost capture: ends the gesture without a flick. */
  pointerCancel(input: PointerInput): void;
  wheel(input: WheelInput): void;
  /** Keyboard rotation: +1 east / north, -1 west / south. */
  nudge(east: number, north: number): void;
  zoomStep(direction: 'in' | 'out'): void;
  /** Advances motion by dt. Returns true if another frame is needed. */
  update(dtSeconds: number): boolean;
  setViewport(widthPx: number, heightPx: number): void;
  setMotion(motion: MotionPreference): void;
  /** Resolves 'cancelled' (never rejects) if user input or another call interrupts it. */
  flyTo(
    lat: number,
    lon: number,
    altitudeKm: number,
    options?: FlyToOptions,
  ): Promise<FlightResult>;
  cancelFlight(): void;
  getState(): CameraPose;
  /** Instant; clears momentum. Animate a restore with flyTo instead. */
  setState(pose: CameraPose): void;
  getLimits(): AltitudeLimits;
  getTelemetry(): ControlsTelemetry;
  /** The coordinate under a canvas pixel, or null over space. */
  surfacePointAt(x: number, y: number): LatLon | null;
  dispose(): void;
}
