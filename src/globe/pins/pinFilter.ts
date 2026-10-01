import {
  categoryMask,
  isFilterActive,
  matchesFilter,
  CLUSTER_ROLE,
  NEWS_CATEGORIES,
  NO_FILTER,
  type ClusterLayout,
  type NodeBuffer,
  type StoryFilter,
} from '@/core';

/**
 * The filters as the pin shader sees them (pinVertex.glsl.ts). A story that
 * does not match is dimmed and shrunk, never hidden.
 *
 * - **Pins** match in the shader: their category against uCategoryOn and
 *   their age (uNow − publish time) against uWithin, so scrubbing with a time
 *   window rewrites nothing per pin, as before.
 * - **Orbs** match when any member does. The shader cannot see members, so
 *   that is worked out here, from the layout's groups, into one attribute
 *   (aOrbMatch). Orbs exist only while the time rests, so it is never redone
 *   mid-scrub.
 * - **A change** cross-fades: the shader holds the previous filter and the
 *   current one and mixes them by uFilterMix over FILTER_FADE_SECONDS.
 */

export const FILTER_FADE_SECONDS = 0.25;

/** Within this much story time, a live clock does not recompute orbs. */
const ORB_RECHECK_SECONDS = 1;

/** The uniforms this module drives; pinMesh.ts declares them. */
export interface FilterUniforms {
  readonly uCategoryOn: { value: Float32Array };
  readonly uCategoryOnPrev: { value: Float32Array };
  /** Seconds back from uNow a pin may be, or −1 for any time. */
  readonly uWithin: { value: number };
  readonly uWithinPrev: { value: number };
  /** 0 shows the previous filter, 1 the current. */
  readonly uFilterMix: { value: number };
}

export function createFilterUniforms(): FilterUniforms {
  return {
    uCategoryOn: { value: new Float32Array(NEWS_CATEGORIES.length).fill(1) },
    uCategoryOnPrev: { value: new Float32Array(NEWS_CATEGORIES.length).fill(1) },
    uWithin: { value: -1 },
    uWithinPrev: { value: -1 },
    uFilterMix: { value: 1 },
  };
}

function writeCategories(filter: StoryFilter, out: Float32Array): void {
  const mask = categoryMask(filter);
  for (let i = 0; i < out.length; i++) out[i] = (mask >> i) & 1;
}

function withinSeconds(filter: StoryFilter): number {
  return filter.withinHours === null ? -1 : filter.withinHours * 3600;
}

/**
 * Per row, whether its group has a matching member: for an orb row, any of
 * the stories it stands for; for a pin, the story itself. Rows outside a
 * group (unpublished, hidden) stay 0.
 */
export function groupMatches(
  nodes: NodeBuffer,
  layout: ClusterLayout,
  nowSec: number,
  filter: StoryFilter,
  out: Uint8Array,
): void {
  const rows = Math.min(nodes.count, layout.count, out.length);
  out.fill(0, 0, rows);
  const mask = categoryMask(filter);
  for (let row = 0; row < rows; row++) {
    const group = layout.groups[row] ?? row;
    if (group < 0 || group >= rows || out[group] === 1) continue;
    if (matchesFilter(nodes, row, nowSec, filter, mask)) out[group] = 1;
  }
}

/** Eases the cross-fade: 1 − (1 − t)³, quick to leave, gentle to land. */
export function filterFade(elapsedSeconds: number): number {
  const t = Math.min(Math.max(elapsedSeconds / FILTER_FADE_SECONDS, 0), 1);
  return 1 - (1 - t) ** 3;
}

export interface FilterState {
  readonly current: StoryFilter;
  /**
   * Switches to `filter`, fading from the one shown, or at once when
   * `instant` (reduced motion). Returns false when nothing changed.
   */
  set(filter: StoryFilter, instant: boolean): boolean;
  /** Moves the fade on by `stepSeconds`; true while it is still running. */
  advance(stepSeconds: number): boolean;
  /** Ends a running fade where it is heading. */
  settle(): void;
  /**
   * Writes every orb slot's (previous, current) match into `orbMatch`, two
   * floats per slot. `force` skips the live-clock shortcut (a new layout).
   */
  writeOrbs(
    nodes: NodeBuffer,
    layout: ClusterLayout,
    rowSlots: Int32Array,
    nowSec: number,
    orbMatch: Float32Array,
    force: boolean,
  ): boolean;
  /** Whether `row` is drawn dimmed, as of the last writeOrbs for orbs. */
  dimmed(nodes: NodeBuffer, layout: ClusterLayout, row: number, nowSec: number): boolean;
}

export function createFilterState(uniforms: FilterUniforms): FilterState {
  let current: StoryFilter = NO_FILTER;
  let previous: StoryFilter = NO_FILTER;
  let elapsed = 0;
  let fading = false;
  let matchedNow = new Uint8Array(0);
  let matchedBefore = new Uint8Array(0);
  let orbsAt = Number.NaN;

  const showFilters = (): void => {
    writeCategories(current, uniforms.uCategoryOn.value);
    writeCategories(previous, uniforms.uCategoryOnPrev.value);
    uniforms.uWithin.value = withinSeconds(current);
    uniforms.uWithinPrev.value = withinSeconds(previous);
  };

  return {
    get current() {
      return current;
    },

    set(filter, instant) {
      const same =
        filter.withinHours === current.withinHours &&
        categoryMask(filter) === categoryMask(current);
      if (same) return false;
      // A change during a fade starts from where the last one was heading.
      previous = instant ? filter : current;
      current = filter;
      elapsed = 0;
      fading = !instant;
      uniforms.uFilterMix.value = instant ? 1 : 0;
      showFilters();
      orbsAt = Number.NaN;
      return true;
    },

    advance(stepSeconds) {
      if (!fading) return false;
      // Its own elapsed time, not the layer's clock, which is rebased now and then.
      elapsed += stepSeconds;
      const mix = filterFade(elapsed);
      uniforms.uFilterMix.value = mix;
      if (mix < 1) return true;
      this.settle();
      return false;
    },

    settle() {
      fading = false;
      previous = current;
      uniforms.uFilterMix.value = 1;
      showFilters();
    },

    writeOrbs(nodes, layout, rowSlots, nowSec, orbMatch, force) {
      if (!force && Math.abs(nowSec - orbsAt) < ORB_RECHECK_SECONDS) return false;
      orbsAt = nowSec;
      const rows = Math.min(nodes.count, layout.count);
      if (matchedNow.length < rows) {
        matchedNow = new Uint8Array(rows);
        matchedBefore = new Uint8Array(rows);
      }
      groupMatches(nodes, layout, nowSec, current, matchedNow);
      groupMatches(nodes, layout, nowSec, previous, matchedBefore);
      for (let row = 0; row < rows; row++) {
        if (layout.roles[row] !== CLUSTER_ROLE.orb) continue;
        const slot = rowSlots[row] ?? -1;
        if (slot < 0 || slot * 2 + 1 >= orbMatch.length) continue;
        orbMatch[slot * 2] = matchedBefore[row] ?? 1;
        orbMatch[slot * 2 + 1] = matchedNow[row] ?? 1;
      }
      return true;
    },

    dimmed(nodes, layout, row, nowSec) {
      if (!isFilterActive(current)) return false;
      if (layout.roles[row] === CLUSTER_ROLE.orb) return matchedNow[row] !== 1;
      return !matchesFilter(nodes, row, nowSec, current);
    },
  };
}
