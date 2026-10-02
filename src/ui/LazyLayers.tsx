import { lazy, Suspense, useState, type ComponentType, type JSX } from 'react';

import type { NodeBuffer } from '@/core';
import { useOnboardingStore, usePanelStore } from '@/state';

import type { LibraryLayerProps } from './library/LibraryLayer';
import { useIdlePreload } from './library/useIdlePreload';
import type { GlobeTarget } from './nav/globeNavigation';
import type { OnboardingLayerProps } from './onboarding/OnboardingLayer';

/** The Following and Saved sheet: its own chunk, fetched when the browser is idle. */
const loadLibrary = (): Promise<{ default: ComponentType<LibraryLayerProps> }> =>
  import('./library/LibraryLayer');
const LibraryLayer = lazy(loadLibrary);

/** First-run onboarding: its own chunk, fetched only when it is about to show. */
const OnboardingLayer = lazy(
  (): Promise<{ default: ComponentType<OnboardingLayerProps> }> =>
    import('./onboarding/OnboardingLayer'),
);

export interface LazyLayersProps {
  readonly nodes: NodeBuffer | null;
  readonly target: GlobeTarget;
  readonly historyHours: number;
  readonly savedStoryLimit: number;
  readonly reducedMotion: boolean;
}

/**
 * The sheets no reader needs to see the globe, each in its own chunk and
 * mounted the first time it opens. They stay mounted after, so closing can
 * slide them away and hand focus back.
 */
export function LazyLayers(props: LazyLayersProps): JSX.Element {
  const { nodes, target, historyHours, savedStoryLimit, reducedMotion } = props;
  const panelOpen = usePanelStore((state) => state.panel !== null);
  const onboardingOpen = useOnboardingStore((state) => state.open);
  const [libraryUsed, setLibraryUsed] = useState(false);
  const [onboardingUsed, setOnboardingUsed] = useState(false);
  if (panelOpen && !libraryUsed) setLibraryUsed(true);
  if (onboardingOpen && !onboardingUsed) setOnboardingUsed(true);
  useIdlePreload(loadLibrary);

  return (
    <>
      {libraryUsed && (
        <Suspense fallback={null}>
          <LibraryLayer
            nodes={nodes}
            target={target}
            historyHours={historyHours}
            savedStoryLimit={savedStoryLimit}
            reducedMotion={reducedMotion}
          />
        </Suspense>
      )}
      {onboardingUsed && (
        <Suspense fallback={null}>
          <OnboardingLayer target={target} reducedMotion={reducedMotion} />
        </Suspense>
      )}
    </>
  );
}
