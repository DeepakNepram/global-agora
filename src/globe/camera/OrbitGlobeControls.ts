import { Quaternion, Vector3 } from 'three';

import { normalizeLon } from '@/core';

import * as scale from './cameraMath';
import { createCameraRig } from './cameraRig';
import { planFlight, type Flight, type FlightResult } from './flight';
import { FRICTION, capSpeed, decayVelocity, type ScreenVelocity } from './inertia';
import { createPointerGestures } from './pointerGestures';
import type {
  ControlsMode,
  MotionPreference,
  OrbitGlobeControls,
  OrbitGlobeControlsOptions,
} from './types';

/** ln(altitude) per wheel pixel: one 100px notch zooms ~16%. */
const WHEEL_ZOOM_RATE = 0.0015;
/** 1/s for the wheel's exp smoothing; closes 70% of the gap in 100 ms. */
const ZOOM_STIFFNESS = 12;
const ZOOM_SETTLED = 1e-4;
/** Arrow keys coast this many screen heights per press. */
const KEY_STEP_SCREENS = 0.15;
/** Holding an arrow key accelerates to this, not to a flick. */
const KEY_MAX_SPEED = 1.5;
const KEY_ZOOM_PX = 120;
/** r3f's first delta after idle spans the whole idle gap; restart from one frame. */
const RESUME_STEP_SECONDS = 1 / 60;
const MAX_STEP_SECONDS = 0.1;

interface ActiveFlight {
  readonly plan: Flight;
  readonly to: scale.CameraPose;
  readonly resolve: (result: FlightResult) => void;
  elapsedMs: number;
}

/**
 * The globe camera: altitude-scaled drag, flick inertia, zoom toward the
 * pointer, pinch, and great-circle flights. DOM-free: src/ui/globe binds real
 * events to it, and it only moves inside update(dt).
 */
export function createOrbitGlobeControls(options: OrbitGlobeControlsOptions): OrbitGlobeControls {
  const rig = createCameraRig(options.camera, options.bodyOrientation ?? new Quaternion());
  const requestFrame = options.requestFrame ?? ((): void => undefined);
  const velocity: ScreenVelocity = { x: 0, y: 0 };
  const centre = new Vector3();
  let targetAltitudeKm = rig.altitudeKm;
  let pinchStartAltitudeKm = rig.altitudeKm;
  let flight: ActiveFlight | null = null;
  let motion: MotionPreference = 'full';
  let wasAnimating = false;

  const finishFlight = (result: FlightResult): void => {
    const done = flight;
    flight = null;
    done?.resolve(result);
  };

  const stopMomentum = (): void => {
    velocity.x = 0;
    velocity.y = 0;
  };

  /** Any direct manipulation: the user takes the camera back. */
  const halt = (): void => {
    finishFlight('cancelled');
    stopMomentum();
    rig.clearAnchor();
    targetAltitudeKm = rig.altitudeKm;
  };

  const place = (pose: scale.CameraPose): void => {
    rig.place(pose);
    targetAltitudeKm = rig.altitudeKm;
    rig.apply();
  };

  const gestures = createPointerGestures({
    onGrab: halt,
    onDrag(dx, dy) {
      rig.turnByScreen(dx / rig.height, dy / rig.height);
      rig.apply();
      requestFrame();
    },
    onPinchStart(midX, midY) {
      halt();
      pinchStartAltitudeKm = rig.altitudeKm;
      rig.setAnchor(midX, midY);
    },
    onPinch(midX, midY, spread) {
      // Applied directly, not smoothed: the globe stays locked under both fingers.
      rig.altitudeKm = targetAltitudeKm = rig.clampAltitude(pinchStartAltitudeKm * spread);
      rig.moveAnchor(midX, midY);
      rig.holdAnchor();
      rig.apply();
      requestFrame();
    },
    onRelease(released) {
      rig.clearAnchor();
      if (motion === 'full') {
        velocity.x = released.x / rig.height;
        velocity.y = released.y / rig.height;
        capSpeed(velocity);
      }
      requestFrame();
    },
  });

  /** Log-space exp smoothing toward the wheel's target, holding the anchor. */
  const stepZoom = (dt: number): boolean => {
    const gap = Math.log(targetAltitudeKm / rig.altitudeKm);
    if (gap === 0) return false;
    //   ln h += (ln target - ln h) * (1 - e^(-k dt))          CLAUDE.md #3
    const next = rig.altitudeKm * Math.exp(gap * (1 - Math.exp(-ZOOM_STIFFNESS * dt)));
    const settled = Math.abs(Math.log(targetAltitudeKm / next)) <= ZOOM_SETTLED;
    rig.altitudeKm = settled ? targetAltitudeKm : next;
    rig.holdAnchor();
    return !settled;
  };

  const controls: OrbitGlobeControls = {
    pointerDown: (input) => gestures.down(input),
    pointerMove: (input) => gestures.move(input),
    pointerUp: (input) => gestures.up(input, false),
    pointerCancel: (input) => gestures.up(input, true),

    wheel(input) {
      finishFlight('cancelled');
      stopMomentum();
      const factor = Math.exp(input.deltaPx * WHEEL_ZOOM_RATE);
      targetAltitudeKm = rig.clampAltitude(targetAltitudeKm * factor);
      rig.setAnchor(input.x, input.y);
      if (motion === 'reduced') {
        rig.altitudeKm = targetAltitudeKm;
        rig.holdAnchor();
        rig.apply();
      }
      requestFrame();
    },

    nudge(east, north) {
      finishFlight('cancelled');
      rig.clearAnchor();
      if (motion === 'reduced') {
        rig.turnByScreen(-east * KEY_STEP_SCREENS, north * KEY_STEP_SCREENS);
        rig.apply();
      } else {
        // An impulse whose coasting distance, v0 / f, is exactly one step.
        velocity.x -= east * KEY_STEP_SCREENS * FRICTION;
        velocity.y += north * KEY_STEP_SCREENS * FRICTION;
        capSpeed(velocity, KEY_MAX_SPEED);
      }
      requestFrame();
    },

    zoomStep(direction) {
      const deltaPx = direction === 'in' ? -KEY_ZOOM_PX : KEY_ZOOM_PX;
      controls.wheel({ deltaPx, x: rig.width / 2, y: rig.height / 2 });
    },

    update(dtSeconds) {
      const limit = wasAnimating ? MAX_STEP_SECONDS : RESUME_STEP_SECONDS;
      const dt = Math.min(Math.max(dtSeconds, 0), limit);
      let animating = false;

      if (flight) {
        flight.elapsedMs += dt * 1000;
        if (flight.elapsedMs >= flight.plan.durationMs) {
          place(flight.to);
          finishFlight('completed');
        } else {
          rig.altitudeKm = targetAltitudeKm = flight.plan.sample(flight.elapsedMs, centre);
          rig.lookDown(centre);
          animating = true;
        }
      } else {
        if ((velocity.x !== 0 || velocity.y !== 0) && gestures.pointerCount === 0) {
          const travel = decayVelocity(velocity, dt);
          if (rig.turnByScreen(travel.dx, travel.dy)) velocity.y = 0;
          animating = velocity.x !== 0 || velocity.y !== 0;
        }
        animating = stepZoom(dt) || animating;
      }

      rig.apply();
      wasAnimating = animating;
      return animating;
    },

    setViewport(widthPx, heightPx) {
      rig.setViewport(widthPx, heightPx);
      rig.altitudeKm = rig.clampAltitude(rig.altitudeKm);
      targetAltitudeKm = rig.clampAltitude(targetAltitudeKm);
      rig.apply();
      requestFrame();
    },

    setMotion(preference) {
      motion = preference;
      if (preference === 'reduced') {
        stopMomentum();
        if (flight) {
          place(flight.to);
          finishFlight('completed');
        }
        rig.altitudeKm = targetAltitudeKm;
        rig.holdAnchor();
        rig.apply();
      }
      requestFrame();
    },

    flyTo(lat, lon, altitudeKm, flyOptions) {
      halt();
      const to = { lat, lon: normalizeLon(lon), altitudeKm: rig.clampAltitude(altitudeKm) };
      requestFrame();
      if (motion === 'reduced') {
        place(to);
        return Promise.resolve('completed');
      }
      const maxKm = scale.maxAltitudeKm(rig.aspect);
      const plan = planFlight(rig.pose(), to, maxKm, flyOptions?.durationMs);
      return new Promise((resolve) => {
        flight = { plan, to, resolve, elapsedMs: 0 };
      });
    },

    cancelFlight: () => finishFlight('cancelled'),

    getState: () => rig.pose(),

    setState(pose) {
      halt();
      place(pose);
      requestFrame();
    },

    getLimits: () => ({
      minKm: scale.MIN_ALTITUDE_KM,
      maxKm: scale.maxAltitudeKm(rig.aspect),
      fitKm: scale.fitAltitudeKm(rig.aspect),
    }),

    getTelemetry() {
      let mode: ControlsMode = 'idle';
      if (flight) mode = 'flight';
      else if (gestures.pointerCount >= 2) mode = 'pinch';
      else if (gestures.pointerCount === 1) mode = 'drag';
      else if (rig.altitudeKm !== targetAltitudeKm) mode = 'zoom';
      else if (velocity.x !== 0 || velocity.y !== 0) mode = 'inertia';
      const radPerScreen = scale.radiansPerScreenHeight(rig.altitudeKm, options.camera.fov);
      const degPerSecond = (Math.hypot(velocity.x, velocity.y) * radPerScreen * 180) / Math.PI;
      return { mode, carriedDegPerSecond: degPerSecond };
    },

    surfacePointAt: (x, y) => rig.pointAt(x, y),

    dispose() {
      finishFlight('cancelled');
      gestures.reset();
    },
  };

  place(options.initialPose ?? { lat: 0, lon: 0, altitudeKm: rig.altitudeKm });
  return controls;
}
