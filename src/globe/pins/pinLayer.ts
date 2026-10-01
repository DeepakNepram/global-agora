import { Group } from 'three';

import { countVisible, type ClusterLayout, type NodeBuffer } from '@/core';

import { earthTiltQuaternion } from '../views';
import { createPinMaterial, createPinUniforms, uploadOrbMatches, uploadSlots } from './pinMesh';
import { createFilterState, FILTER_FADE_SECONDS } from './pinFilter';
import { landSprings, rebaseClock, writeAppearance } from './pinInstances';
import type { PinLayer, PinLayerOptions } from './pinLayerTypes';
import { pickPin } from './pinPick';
import { cameraProjection, selectedSlot } from './pinSelection';
import {
  DEFAULT_CAPACITY,
  MAX_STEP_SECONDS,
  RESUME_STEP_SECONDS,
  RETIME_REST_SECONDS,
  directionOf,
} from './pinLayerRules';
import { createSlotMap } from './pinSlots';
import { createPinStorage } from './pinStorage';
import { PIN_HALF_SIZE_CSS_PX, PULSE_CLOCK_REBASE_SECONDS } from './pinStyle';
import { planTransitions } from './transitions';

export type {
  PickViewport,
  PinLayer,
  PinLayerOptions,
  PresentOptions,
  PresentResult,
} from './pinLayerTypes';

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

  const storage = createPinStorage(tilt, material, uniforms, options.capacity ?? DEFAULT_CAPACITY);
  const filter = createFilterState(uniforms);
  const slots = createSlotMap();
  let nodes: NodeBuffer | null = null;
  let shown: ClusterLayout | null = null;
  let selectedId: number | null = null;
  let rowSlots: Int32Array = new Int32Array(0);
  let level: number | null = null;
  let opened = false;
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

  /** Lands every spring where it is heading: reduced motion switched on mid-bloom. */
  const settleAll = (): void => {
    landSprings(storage.pins.array, slots.highWater, clock);
    settlesAt = clock;
    for (const release of releases) slots.release(release.slots);
    releases = [];
    uploadSlots(storage.pins, slots.highWater);
  };

  /** Orbs match when any member does; redone for a new layout, a filter, or a window's edge moving. */
  const matchOrbs = (force: boolean): void => {
    if (!nodes || !shown) return;
    const array = storage.pins.orbMatch.array as Float32Array;
    if (filter.writeOrbs(nodes, shown, rowSlots, nowSeconds, array, force)) {
      uploadOrbMatches(storage.pins, slots.highWater);
    }
  };

  return {
    object3d: tilt,

    get capacity() {
      return storage.pins.buffer.count;
    },

    present(next, layout, presentOptions = {}) {
      const reset = presentOptions.reset === true;
      if (reset) {
        slots.reset();
        storage.groupSlot.fill(-1);
        releases = [];
        level = null;
        opened = false;
      }
      const instant = reset || nodes === null || reducedMotion;
      const { rowSlots: assigned, departed, fresh } = slots.assign(next.ids, next.count);
      storage.ensureCapacity(slots.highWater);
      // A level change re-presents the same stories, whose publish times are
      // already written and whose freshness the shader derives.
      if (next !== nodes || reset) {
        published = writeAppearance(
          next,
          assigned,
          storage.pins.array,
          nowSeconds,
          originSeconds,
          clock,
          fresh,
        );
        ratesDue = false;
      }
      nodes = next;
      shown = layout;
      rowSlots = assigned;
      uniforms.uSelected.value = selectedSlot(nodes, shown, rowSlots, selectedId);

      const plan = planTransitions({
        array: storage.pins.array,
        slotCount: slots.highWater,
        nodes: next,
        layout,
        rowSlots,
        fresh,
        groupSlot: storage.groupSlot,
        departed,
        clock,
        direction: directionOf(level, opened, layout),
        instant,
      });
      level = layout.level;
      opened = layout.open;
      settlesAt = Math.max(settlesAt, plan.endsAt);
      if (departed.length > 0) {
        if (instant) slots.release(departed);
        else releases.push({ at: plan.endsAt, slots: departed });
      }
      uploadSlots(storage.pins, slots.highWater);
      matchOrbs(true);
      storage.pins.mesh.count = slots.highWater;
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
      // Open layouts (the time moving) have no orbs; at rest a window's edge still moves with a live clock.
      if (filter.current.withinHours !== null && shown && !shown.open) matchOrbs(false);
    },

    setFilter(next) {
      if (!filter.set(next, reducedMotion)) return;
      matchOrbs(true);
      if (!reducedMotion) settlesAt = Math.max(settlesAt, clock + FILTER_FADE_SECONDS);
    },

    pick(x, y, camera, viewport, radiusPx) {
      const drawn = nodes;
      const layout = shown;
      if (!drawn || !layout || !tilt.visible) return null;
      return pickPin({
        nodes: drawn,
        layout,
        nowSec: nowSeconds,
        x,
        y,
        ...(radiusPx === undefined ? {} : { radiusPx }),
        project: cameraProjection(tilt, camera, viewport.width, viewport.height),
        dimmed: (row) => filter.dimmed(drawn, layout, row, nowSeconds),
      });
    },

    setSelected(id) {
      selectedId = id;
      uniforms.uSelected.value = selectedSlot(nodes, shown, rowSlots, selectedId);
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
      if (reducedMotion) filter.settle();
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
        clock = rebaseClock(storage.pins.array, slots.highWater, clock, by);
        settlesAt -= by;
        releases = releases.map((release) => ({ ...release, at: release.at - by }));
        uploadSlots(storage.pins, slots.highWater);
      }
      uniforms.uTime.value = clock;
      filter.advance(step);

      restSeconds += step;
      if (ratesDue && nodes && restSeconds >= RETIME_REST_SECONDS) {
        writeAppearance(
          nodes,
          rowSlots,
          storage.pins.array,
          nowSeconds,
          originSeconds,
          clock,
          null,
        );
        uploadSlots(storage.pins, slots.highWater);
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
      storage.dispose();
      material.dispose();
    },
  };
}
