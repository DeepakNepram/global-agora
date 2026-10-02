import { useState, type JSX } from 'react';

import type { NodeBuffer } from '@/core';
import { useOnboardingStore, usePanelStore } from '@/state';

import LibraryLayer from './library/LibraryLayer';
import type { GlobeTarget } from './nav/globeNavigation';
import OnboardingLayer from './onboarding/OnboardingLayer';

export interface SecondarySheetsProps {
  readonly nodes: NodeBuffer | null;
  readonly target: GlobeTarget;
  readonly historyHours: number;
  readonly savedStoryLimit: number;
  readonly reducedMotion: boolean;
}

/**
 * The library (Following, Saved) and the onboarding, each mounted the first
 * time it opens and kept after, so closing can slide it away and hand focus
 * back. In the main chunk on purpose: as lazy chunks, the bundler moved
 * 139 KB of modules they share with the app into a separate startup chunk,
 * which cost more than the 8.5 KB they saved (docs/DECISIONS.md).
 */
export function SecondarySheets(props: SecondarySheetsProps): JSX.Element {
  const { nodes, target, historyHours, savedStoryLimit, reducedMotion } = props;
  const panelOpen = usePanelStore((state) => state.panel !== null);
  const onboardingOpen = useOnboardingStore((state) => state.open);
  const [libraryUsed, setLibraryUsed] = useState(false);
  const [onboardingUsed, setOnboardingUsed] = useState(false);
  if (panelOpen && !libraryUsed) setLibraryUsed(true);
  if (onboardingOpen && !onboardingUsed) setOnboardingUsed(true);

  return (
    <>
      {libraryUsed && (
        <LibraryLayer
          nodes={nodes}
          target={target}
          historyHours={historyHours}
          savedStoryLimit={savedStoryLimit}
          reducedMotion={reducedMotion}
        />
      )}
      {onboardingUsed && <OnboardingLayer target={target} reducedMotion={reducedMotion} />}
    </>
  );
}
