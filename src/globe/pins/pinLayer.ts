import { Group } from 'three';

import { countVisible, type NodeBuffer } from '@/core';

import { earthTiltQuaternion } from '../views';
import {
  createPinMaterial,
  createPinMesh,
  createPinUniforms,
  disposePinMesh,
  nextPowerOfTwo,
  uploadSlots,
  type PinMesh,
} from './pinMesh';
import { landSprings, rebaseClock, writeAppearance } from './pinInstances';
import type { PinLayer, PinLayerOptions } from './pinLayerTypes';
import { createSlotMap } from './pinSlots';
import { PIN_HALF_SIZE_CSS_PX, PULSE_CLOCK_REBASE_SECONDS } from './pinStyle';
import { planTransitions } from './transitions';

/** Enough for the 3000-story target, plus departures fading out, without growing. */
const DEFAULT_CAPACITY = 4096;

/** A step longer than this is a resumed tab, not motion; see earth.ts. */
const MAX_STEP_SECONDS = 0.25;

/**
 * The first step after the layer was idle. r3f's first delta after an idle
 * spell spans the whole spell, which would skip the start of a bloom; the
 * camera controls cap the same way (RESUME_STEP_SECONDS).
 */
const RESUME_STEP_SECONDS = 1 / 60;

/**
 * Pulse rates follow the displayed time once it has rested this long. A scrub
 * moves only uNow; re-deriving every rate on the CPU each tick would cost a
 * pass and a buffer upload per frame for a frequency nobody can judge mid-drag.
 */
const RETIME_REST_SECONDS = 0.25;

export type { PinLayer, PinLayerOptions, PresentOptions, PresentResult } from './pinLayerTypes';

/**
 * The news pins: one InstancedMesh (see pinMesh.ts) whose slots are keyed by
 * story id (pinSlots.ts), drawn as pins or cluster orbs and moved by the
 * transition planner (transitions.ts).
 *
 *   tilt           quaternion = 23.44° about X (same as the Earth)
 *    └─ pins       InstancedMesh, quad × slots, renderOrder 3
 */
export function createPinLayer(options: PinLayerOptions): PinLayer {
  const uniforms = createPinUniforms();
  const material = createPinMaterial(uniforms);
  const tilt = new Group();
  tilt.name = 'pins-tilt';
  earthTiltQuaternion(tilt.quaternion);

  const attach = (capacity: number): PinMesh => {
    const built = createPinMesh(capacity, material);
    built.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      built.mesh.worldToLocal(
        uniforms.uCameraLocal.value.setFromMatrixPosition(camera.matrixWorld),
      );
    };
    tilt.add(built.mesh);
    return built;
  };

  const slots = createSlotMap();
  let pins = attach(nextPowerOfTwo(options.capacity ?? DEFAULT_CAPACITY));
  let groupSlot = new Int32Array(pins.buffer.count).fill(-1);
  let nodes: NodeBuffer | null = null;
  let rowSlots: Int32Array = new Int32Array(0);
  let level: number | null = null;
  let nowSeconds = options.timeMs / 1000;
  const originSeconds = Math.floor(nowSeconds);
  uniforms.uNow.value = nowSeconds - originSeconds;
  let ratesDue = false;
  let restSeconds = 0;
  let clock = 0;
  let settlesAt = 0;
  let releases: { at: number; slots: readonly number[] }[] = [];
  let published = 0;
  let reducedMotion = false;
  let wasActive = false;

  const ensureCapacity = (needed: number): void => {
    if (needed <= pins.buffer.count) return;
    // Replace, never add, so there is still exactly one InstancedMesh; the
    // slots carry over as they are, animations and all.
    const previous = pins;
    pins = attach(nextPowerOfTwo(needed));
    pins.array.set(previous.array);
    disposePinMesh(previous);
    const groups = new Int32Array(pins.buffer.count).fill(-1);
    groups.set(groupSlot);
    groupSlot = groups;
  };

  /** Lands every spring where it is heading: reduced motion switched on mid-bloom. */
  const settleAll = (): void => {
    landSprings(pins.array, slots.highWater, clock);
    settlesAt = clock;
    for (const release of releases) slots.release(release.slots);
    releases = [];
    uploadSlots(pins, slots.highWater);
  };

  return {
    object3d: tilt,

    get capacity() {
      return pins.buffer.count;
    },

    present(next, layout, presentOptions = {}) {
      const reset = presentOptions.reset === true;
      if (reset) {
        slots.reset();
        groupSlot.fill(-1);
        releases = [];
        level = null;
      }
      const instant = reset || nodes === null || reducedMotion;
      const { rowSlots: assigned, departed, fresh } = slots.assign(next.ids, next.count);
      ensureCapacity(slots.highWater);
      // A level change re-presents the same stories, whose publish times are
      // already written and whose freshness the shader derives.
      if (next !== nodes || reset) {
        published = writeAppearance(
          next,
          assigned,
          pins.array,
          nowSeconds,
          originSeconds,
          clock,
          fresh,
        );
        ratesDue = false;
      }
      nodes = next;
      rowSlots = assigned;

      const plan = planTransitions({
        array: pins.array,
        slotCount: slots.highWater,
        nodes: next,
        layout,
        rowSlots,
        fresh,
        groupSlot,
        departed,
        clock,
        direction: level === null ? 0 : Math.sign(layout.level - level),
        instant,
      });
      level = layout.level;
      settlesAt = Math.max(settlesAt, plan.endsAt);
      if (departed.length > 0) {
        if (instant) slots.release(departed);
        else releases.push({ at: plan.endsAt, slots: departed });
      }
      uploadSlots(pins, slots.highWater);
      pins.mesh.count = slots.highWater;
      return { moving: plan.moving, durationMs: Math.max(0, plan.endsAt - clock) * 1000 };
    },

    setTime(timeMs) {
      if (!Number.isFinite(timeMs)) return;
      nowSeconds = timeMs / 1000;
      uniforms.uNow.value = nowSeconds - originSeconds;
      if (!nodes) return;
      published = countVisible(nodes, nowSeconds);
      ratesDue = true;
      restSeconds = 0;
    },

    setViewport(bufferWidth, bufferHeight, pixelRatio) {
      uniforms.uViewport.value.set(Math.max(1, bufferWidth), Math.max(1, bufferHeight));
      uniforms.uHalfSizePx.value = PIN_HALF_SIZE_CSS_PX * pixelRatio;
      uniforms.uPixelRatio.value = pixelRatio;
    },

    setMotion(motion) {
      reducedMotion = motion === 'reduced';
      uniforms.uPulse.value = reducedMotion ? 0 : 1;
      if (reducedMotion && clock < settlesAt) settleAll();
    },

    setVisible(visible) {
      tilt.visible = visible;
    },

    setBadgeAtlas(atlas) {
      uniforms.uBadgeAtlas.value = atlas;
      uniforms.uHasBadges.value = atlas ? 1 : 0;
    },

    animationRemainingMs: () => Math.max(0, settlesAt - clock) * 1000,

    advance(dtSeconds) {
      const moving = clock < settlesAt;
      const pulsing = !reducedMotion && tilt.visible && published > 0;
      if (!(moving || pulsing) || !(dtSeconds > 0)) {
        wasActive = false;
        return false;
      }
      const step = Math.min(dtSeconds, wasActive ? MAX_STEP_SECONDS : RESUME_STEP_SECONDS);
      clock += step;
      wasActive = true;

      if (clock > PULSE_CLOCK_REBASE_SECONDS) {
        const by = clock;
        clock = rebaseClock(pins.array, slots.highWater, clock, by);
        settlesAt -= by;
        releases = releases.map((release) => ({ ...release, at: release.at - by }));
        uploadSlots(pins, slots.highWater);
      }
      uniforms.uTime.value = clock;

      restSeconds += step;
      if (ratesDue && nodes && restSeconds >= RETIME_REST_SECONDS) {
        writeAppearance(nodes, rowSlots, pins.array, nowSeconds, originSeconds, clock, null);
        uploadSlots(pins, slots.highWater);
        ratesDue = false;
      }

      // Slots whose stories left are reusable once their fade-out has played.
      const due = releases.filter((release) => release.at <= clock);
      if (due.length > 0) {
        for (const release of due) slots.release(release.slots);
        releases = releases.filter((release) => release.at > clock);
      }
      return pulsing || clock < settlesAt;
    },

    dispose() {
      tilt.removeFromParent();
      disposePinMesh(pins);
      material.dispose();
    },
  };
}
