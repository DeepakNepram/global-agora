import { useMemo, useState } from 'react';

import { PETAL_LEVEL } from '@/core';
import {
  ACTIVATE_RADIUS_CSS_PX,
  altitudeKmForZoom,
  type OrbitGlobeControls,
  type PinPick,
} from '@/globe';
import { storyStore } from '@/state';

import { nextAnnouncement } from '../announce';
import type { GlobeInputHandlers } from './bindControlInput';
import type { PinPicker } from './pinPicker';

/** A tap on a cluster flies this many levels deeper, enough to open most clusters. */
export const CLUSTER_TAP_LEVELS = 2;

/** Lands inside the target level's band, clear of its hysteresis (clusterZoom.ts). */
const LEVEL_MIDDLE = 0.5;

const NOTHING_AT_CENTRE =
  'No story near the centre. Turn the globe with the arrow keys, or zoom with plus and minus.';

export interface GlobeSelection {
  readonly input: GlobeInputHandlers;
  /** What the last keyboard pick did, for a polite live region. */
  readonly message: string;
}

/**
 * What a tap or Enter on the globe does:
 *   - a story's pin opens its peek card, or switches the open sheet to it;
 *   - a cluster's orb flies the camera to it, two levels deeper, so it blooms;
 *   - nothing closes a peek card (a full sheet stays: it covers the globe).
 * Escape steps an open sheet down.
 */
export function useGlobeSelection(
  controls: OrbitGlobeControls | null,
  picker: PinPicker,
): GlobeSelection {
  const [message, setMessage] = useState('');

  const input = useMemo((): GlobeInputHandlers => {
    const announce = (text: string): void =>
      setMessage((previous) => nextAnnouncement(previous, text));

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
        if (fromKeyboard) announce(`Zooming in on ${hit.count} stories.`);
      } else if (fromKeyboard) {
        announce(NOTHING_AT_CENTRE);
      } else if (story.sheet === 'peek') {
        story.close();
      }
    };

    return {
      onTap: (x, y) => choose(picker.pick(x, y), false),
      onActivate: (x, y) => choose(picker.pick(x, y, ACTIVATE_RADIUS_CSS_PX), true),
      onEscape: () => {
        const story = storyStore.getState();
        if (story.sheet === 'closed') return false;
        story.collapse();
        return true;
      },
    };
  }, [controls, picker]);

  return { input, message };
}
