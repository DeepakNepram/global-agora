import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { PerspectiveCamera } from 'three';

import {
  createOrbitGlobeControls,
  type CameraPose,
  earthTiltQuaternion,
  fitAltitudeKm,
  type MotionPreference,
  type OrbitGlobeControls,
} from '@/globe';

import { bindControlInput, type GlobeInputHandlers } from './bindControlInput';

/**
 * Before scene updates (priority 0) and the render (priority 1): the frame is
 * drawn from the pose this callback just wrote.
 */
const CONTROLS_PRIORITY = -1;

export interface GlobeControlsOptions {
  readonly motion: MotionPreference;
  /** Receives the controls once created, and null when they are torn down. */
  readonly onReady: (controls: OrbitGlobeControls | null) => void;
  /** Taps, Enter and Escape on the globe; may change without re-binding input. */
  readonly input?: GlobeInputHandlers;
  /** Where the camera starts (a shared link's view); the world view when absent. */
  readonly initialPose?: CameraPose | null;
}

/**
 * Mounts OrbitGlobeControls on r3f's camera and the canvas's event element.
 * Frames are demand-driven: input and API calls request one through
 * `invalidate`, and each frame asks for the next only while motion continues.
 */
export function useGlobeControls(options: GlobeControlsOptions): void {
  const { motion, onReady, input } = options;
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const get = useThree((state) => state.get);
  const eventTarget: unknown = useThree((state) => state.events.connected);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const [controls, setControls] = useState<OrbitGlobeControls | null>(null);
  const inputRef = useRef(input);
  // Read once, at creation: a later change of link must not rebuild the controls.
  const [initialPose] = useState(options.initialPose ?? null);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const { size } = get();
    const created = createOrbitGlobeControls({
      camera,
      bodyOrientation: earthTiltQuaternion(),
      requestFrame: invalidate,
      initialPose: initialPose ?? {
        lat: 0,
        lon: 0,
        altitudeKm: fitAltitudeKm(size.width / Math.max(1, size.height)),
      },
    });
    setControls(created);
    onReady(created);
    return () => {
      onReady(null);
      setControls(null);
      created.dispose();
    };
  }, [camera, invalidate, get, onReady, initialPose]);

  useEffect(() => {
    controls?.setViewport(width, height);
  }, [controls, width, height]);

  useEffect(() => {
    controls?.setMotion(motion);
  }, [controls, motion]);

  useEffect(() => {
    if (!controls || !(eventTarget instanceof HTMLElement)) return;
    // Through the ref, so new handlers never re-bind (and reset) a gesture.
    return bindControlInput(eventTarget, controls, {
      onTap: (x, y) => inputRef.current?.onTap(x, y),
      onActivate: (x, y) => inputRef.current?.onActivate(x, y),
      onEscape: () => inputRef.current?.onEscape() ?? false,
    });
  }, [controls, eventTarget]);

  useFrame((_state, delta) => {
    if (controls?.update(delta)) invalidate();
  }, CONTROLS_PRIORITY);
}
