import { useState, type JSX } from 'react';

import type { AuthProvider, NodeBuffer } from '@/core';
import { useOnboardingStore, usePanelStore } from '@/state';

import { AccountLayer } from './account/AccountLayer';
import LibraryLayer from './library/LibraryLayer';
import type { ViewTarget } from './nav/viewNavigation';
import OnboardingLayer from './onboarding/OnboardingLayer';

export interface SecondarySheetsProps {
  readonly nodes: NodeBuffer | null;
  readonly target: ViewTarget;
  readonly historyHours: number;
  readonly savedStoryLimit: number;
  readonly reducedMotion: boolean;
  /** Ways to sign in, or null without a backend. */
  readonly authProviders: readonly AuthProvider[] | null;
  /** A modal sheet is up: the library waits behind it, inert. */
  readonly covered: boolean;
}

/**
 * The library (Following, Saved), the onboarding and the account's sheets,
 * each mounted the first time it opens and kept after, so closing can slide it away and hand focus
 * back. In the main chunk on purpose: as lazy chunks, the bundler moved
 * 139 KB of modules they share with the app into a separate startup chunk,
 * which cost more than the 8.5 KB they saved (docs/DECISIONS.md).
 */
export function SecondarySheets(props: SecondarySheetsProps): JSX.Element {
  const { nodes, target, historyHours, savedStoryLimit, reducedMotion, authProviders } = props;
  const panelOpen = usePanelStore((state) => state.panel !== null);
  const onboardingOpen = useOnboardingStore((state) => state.open);
  const [libraryUsed, setLibraryUsed] = useState(false);
  const [onboardingUsed, setOnboardingUsed] = useState(false);
  if (panelOpen && !libraryUsed) setLibraryUsed(true);
  if (onboardingOpen && !onboardingUsed) setOnboardingUsed(true);

  return (
    <>
      {libraryUsed && (
        <div className="contents" inert={props.covered}>
          <LibraryLayer
            nodes={nodes}
            target={target}
            historyHours={historyHours}
            savedStoryLimit={savedStoryLimit}
            reducedMotion={reducedMotion}
          />
        </div>
      )}
      {onboardingUsed && <OnboardingLayer target={target} reducedMotion={reducedMotion} />}
      {authProviders !== null && (
        <AccountLayer providers={authProviders} reducedMotion={reducedMotion} />
      )}
    </>
  );
}
