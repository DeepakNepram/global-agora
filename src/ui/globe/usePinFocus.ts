import { useEffect, useMemo, useRef, useState } from 'react';

import { nearestFirst, stepFocus, type NodeBuffer } from '@/core';
import type { PinTarget } from '@/globe';
import { storyStore, wallClockNow } from '@/state';

import type { ViewCamera } from '../nav/viewNavigation';
import { uncoveredBounds } from './focusRing';
import { describePinTarget } from './pinFocusText';
import type { PinPicker } from './pinPicker';

/** The pin (or orb) Tab has landed on. */
export interface FocusedPin {
  /** Its kind and story id: stable while the camera moves and the layout changes. */
  readonly key: string;
  readonly target: PinTarget;
}

export interface PinFocusActions {
  /**
   * Tab (or Shift+Tab) on the view: moves to the next visible pin, nearest
   * the centre first, and says what it is. False when focus should leave
   * the view as usual: past the last pin, or back past the view itself.
   */
  tab(element: HTMLElement, backward: boolean): boolean;
  /** The focused pin, as Enter should open it; null when none. */
  current(): FocusedPin | null;
  clear(): void;
  /** Focus left the view: forget the pin, unless its story's sheet took focus. */
  blurred(): void;
}

export interface PinFocus extends PinFocusActions {
  readonly focused: FocusedPin | null;
}

/** Below these the camera has not moved, and the round of Tab goes on as it was. */
function poseKey(camera: ViewCamera | null): string {
  if (!camera) return '';
  const { lat, lon, altitudeKm } = camera.getState();
  return `${lat.toFixed(4)},${lon.toFixed(4)},${altitudeKm.toFixed(1)}`;
}

function keyOf(target: PinTarget, nodes: NodeBuffer): string {
  return target.kind === 'story'
    ? `story:${target.id}`
    : `orb:${nodes.ids[target.row] ?? target.row}`;
}

/**
 * Tab through the pins on the globe or the flat map (Prompt 5.1). The round
 * is the visible pins and orbs the filters keep, nearest the centre first;
 * it holds while the camera is still, and is worked out again from the
 * focused pin once it moves. Pins under the search bar, the scrubber or an
 * open sheet are not visible, so not in it.
 */
export function usePinFocus(
  source: PinPicker,
  camera: ViewCamera | null,
  nodes: NodeBuffer | null,
  announce: (text: string) => void,
): PinFocus {
  const [focused, setFocused] = useState<FocusedPin | null>(null);
  const focusedRef = useRef<FocusedPin | null>(null);
  const round = useRef<{ pose: string; keys: readonly string[] } | null>(null);
  const context = useRef({ camera, nodes, announce });

  useEffect(() => {
    context.current = { camera, nodes, announce };
  });

  // New stories reuse rows: a focus kept across them could ring a stranger.
  useEffect(() => {
    focusedRef.current = null;
    round.current = null;
    setFocused(null);
  }, [nodes]);

  const actions = useMemo((): PinFocusActions => {
    const set = (next: FocusedPin | null): void => {
      focusedRef.current = next;
      setFocused(next);
    };

    return {
      tab(element, backward) {
        const { camera: view, nodes: stories, announce: say } = context.current;
        if (!stories) return false;
        const targets = source.targets(uncoveredBounds(element)).filter((t) => !t.dimmed);
        const byKey = new Map(targets.map((t) => [keyOf(t, stories), t]));
        const pose = poseKey(view);
        const kept = round.current;
        let keys: readonly string[];
        if (kept && kept.pose === pose) {
          keys = kept.keys.filter((key) => byKey.has(key));
        } else {
          const box = element.getBoundingClientRect();
          const centre = { x: box.width / 2, y: box.height / 2 };
          keys = nearestFirst(targets, centre).map((i) => keyOf(targets[i] as PinTarget, stories));
        }
        round.current = { pose, keys };

        const at = focusedRef.current ? keys.indexOf(focusedRef.current.key) : -1;
        const next = stepFocus(keys.length, at, backward);
        if (next === null) {
          set(null);
          return false;
        }
        if (next < 0) {
          set(null);
          say('Back to the whole view. Tab goes through the pins again.');
          return true;
        }
        const key = keys[next] ?? '';
        const target = byKey.get(key);
        if (!target) return false;
        set({ key, target });
        say(
          describePinTarget(target, stories, wallClockNow(), {
            index: next,
            total: keys.length,
          }),
        );
        return true;
      },
      current: () => focusedRef.current,
      clear: () => set(null),
      blurred: () => {
        if (storyStore.getState().sheet === 'closed') set(null);
      },
    };
  }, [source]);

  return useMemo(() => ({ ...actions, focused }), [actions, focused]);
}
