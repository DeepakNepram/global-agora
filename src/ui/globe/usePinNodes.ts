import { useMemo } from 'react';

import { createNodeBuffer, fillMockNodes, type NodeBuffer } from '@/core';
import { timeStore, useNodesStore } from '@/state';

import type { PinSource } from './debugControls';

/** Fixed, so every load and every benchmark draws the same placeholder pins. */
const MOCK_SEED = 1;

/**
 * The stories the pin layer draws: the live payload, or (from the dev panel
 * and the pin benchmark) a seeded mock load. Null until live stories arrive.
 */
export function usePinNodes(source: PinSource, windowHours: number): NodeBuffer | null {
  const live = useNodesStore((state) => state.nodes);

  // The mock window ends at the instant shown when it is generated, so live
  // mode then ages it in real time and a scrub back hides the newest.
  const mock = useMemo(
    () =>
      source === 'live'
        ? null
        : fillMockNodes(createNodeBuffer(source), {
            count: source,
            windowEndMs: timeStore.getState().timeMs,
            windowHours,
            seed: MOCK_SEED,
          }),
    [source, windowHours],
  );

  return source === 'live' ? live : mock;
}
