import { useMemo, useState } from 'react';

import { PETAL_LEVEL, type NodeBuffer } from '@/core';
import {
  ACTIVATE_RADIUS_CSS_PX,
  altitudeKmForZoom,
  fitAltitudeKm,
  type OrbitGlobeControls,
  type PinPick,
} from '@/globe';
import { onboardingStore, storyStore } from '@/state';

import { nextAnnouncement } from '../announce';
import type { GlobeInputHandlers } from './bindControlInput';
import type { PinPicker } from './pinPicker';
import { usePinFocus, type FocusedPin } from './usePinFocus';

/** A tap on a cluster flies this many levels deeper, enough to open most clusters. */
export const CLUSTER_TAP_LEVELS = 2;

/** Lands inside the target level's band, clear of its hysteresis (clusterZoom.ts). */
const LEVEL_MIDDLE = 0.5;

const NOTHING_AT_CENTRE =
  'No story near the centre. Tab goes through the pins in view, the arrow keys turn the globe, ' +
  'and plus and minus zoom.';

export interface GlobeSelection {
  readonly input: GlobeInputHandlers;
  /** What the last keyboard move did, for a polite live region. */
  readonly message: string;
  /** The pin Tab has landed on (Prompt 5.1), which the focus ring follows. */
  readonly focused: FocusedPin | null;
}

/**
 * What a tap or a key on the globe does:
 *   - a story's pin opens its peek card, or switches the open sheet to it;
 *   - a cluster's orb flies the camera to it, two levels deeper, so it blooms;
 *   - nothing closes a peek card (a full sheet stays: it covers the globe).
 * Tab goes through the visible pins (usePinFocus.ts) and Enter opens the
 * focused one, or with none focused the story nearest the centre. Escape
 * steps an open sheet down, else leaves the focused pin; Home flies back to
 * the resting view, centred on the reader's home city when they gave one.
 */
export function useGlobeSelection(
  controls: OrbitGlobeControls | null,
  picker: PinPicker,
  nodes: NodeBuffer | null,
): GlobeSelection {
  const [message, setMessage] = useState('');
  const announce = useMemo(
    () =>
      (text: string): void =>
        setMessage((previous) => nextAnnouncement(previous, text)),
    [],
  );
  const pins = usePinFocus(picker, controls, nodes, announce);
  const { tab, current, clear, blurred } = pins;

  const input = useMemo((): GlobeInputHandlers => {
    const flyInto = (hit: Extract<PinPick, { kind: 'cluster' }>): void => {
      if (!controls) return;
      const level = Math.min(hit.level + CLUSTER_TAP_LEVELS, PETAL_LEVEL) + LEVEL_MIDDLE;
      const target = altitudeKmForZoom(level, picker.viewport().height);
      // Never back out: a cluster tapped from close in stays as close.
      void controls.flyTo(hit.at.lat, hit.at.lon, Math.min(target, controls.getState().altitudeKm));
    };

    const choose = (hit: PinPick | null, fromKeyboard: boolean): void => {
      const story = storyStore.getState();
      if (hit?.kind === 'story') {
        story.open(hit.id);
      } else if (hit?.kind === 'cluster') {
        flyInto(hit);
        if (fromKeyboard) announce(`Zooming in on ${hit.count} stories. Tab goes through them.`);
      } else if (fromKeyboard) {
        announce(NOTHING_AT_CENTRE);
      } else if (story.sheet === 'peek') {
        story.close();
      }
    };

    return {
      onTap: (x, y) => choose(picker.pick(x, y), false),
      onActivate: (x, y) => {
        const focused = current();
        // The orb opens into new pins, so the next Tab starts again from the centre.
        if (focused?.target.kind === 'cluster') clear();
        choose(focused ? focused.target : picker.pick(x, y, ACTIVATE_RADIUS_CSS_PX), true);
      },
      onEscape: () => {
        const story = storyStore.getState();
        if (story.sheet !== 'closed') {
          story.collapse();
          return true;
        }
        if (current() === null) return false;
        clear();
        announce('Back to the whole view.');
        return true;
      },
      onHome: () => {
        if (!controls) return false;
        const home = onboardingStore.getState().homeCity;
        const { width, height } = picker.viewport();
        void controls.flyTo(
          home?.lat ?? 0,
          home?.lon ?? 0,
          fitAltitudeKm(width / Math.max(1, height)),
        );
        announce(home ? `Back to ${home.label}.` : 'Back to the world view.');
        return true;
      },
      onTab: tab,
      onBlur: blurred,
    };
  }, [controls, picker, announce, tab, current, clear, blurred]);

  return { input, message, focused: pins.focused };
}
