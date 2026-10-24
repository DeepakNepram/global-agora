import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { CONTEXT_RESTORE_WAIT_MS, type QualityTier } from '@/core';
import type { CameraPose, OrbitGlobeControls } from '@/globe';
import { globeHealthStore, useGlobeHealth, wallClockNow } from '@/state';

import { reportWarning } from '../platform/errorReporting';

export interface GlobeRecovery {
  /** Counts the canvases made: the canvas's key, so a new one mounts. */
  readonly generation: number;
  readonly restoring: boolean;
  /** Where the camera was when the context was lost; null before any loss. */
  readonly resumePose: RefObject<CameraPose | null>;
  readonly onContextLost: () => void;
  readonly onContextRestored: () => void;
}

/**
 * A lost WebGL context (Prompt 5.2): a new canvas takes over where the camera
 * was, when the browser says the context is back or after a short wait.
 * globeHealthStore decides when to stop trying; each loss is a Sentry warning.
 */
export function useGlobeRecovery(
  controls: OrbitGlobeControls | null,
  tier: QualityTier,
): GlobeRecovery {
  const generation = useGlobeHealth((state) => state.generation);
  const restoring = useGlobeHealth((state) => state.restoring);
  const resumePose = useRef<CameraPose | null>(null);

  const onContextLost = useCallback(() => {
    resumePose.current = controls?.getState() ?? null;
    globeHealthStore.getState().contextLost(wallClockNow());
    const { lossesMs, fallback } = globeHealthStore.getState();
    const losses = String(lossesMs.length);
    // Numbered, so Sentry's dedupe keeps each; grouped as one issue.
    reportWarning(
      `WebGL context lost (${losses} in 10 min)`,
      { tier, losses },
      'webgl-context-lost',
    );
    if (fallback === 'lost') reportWarning('The globe gave way to the flat map', { tier });
  }, [controls, tier]);

  const onContextRestored = useCallback(() => globeHealthStore.getState().remount(), []);

  useEffect(() => {
    if (!restoring) return;
    const timer = window.setTimeout(onContextRestored, CONTEXT_RESTORE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [restoring, onContextRestored]);

  return { generation, restoring, resumePose, onContextLost, onContextRestored };
}
