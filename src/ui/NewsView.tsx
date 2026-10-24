import { Suspense, useMemo, useState, type JSX } from 'react';

import type { AuthProvider, Permalink, QualityTier } from '@/core';
import { renderSettingsForTier, type OrbitGlobeControls } from '@/globe';
import { useAccountStore, useDiscussionStage, usePanelStore, useStoryStore } from '@/state';

import { createPresentLog } from './globe/bloomReport';
import { createFrameProbe } from './globe/frameProbe';
import { LazyGlobeDevTools } from './globe/LazyGlobeDevTools';
import { createPinPicker } from './globe/pinPicker';
import { useDevSettings } from './globe/useDevSettings';
import { useGlobeSelection } from './globe/useGlobeSelection';
import { useLiveClock } from './globe/useLiveClock';
import { usePinNodes } from './globe/usePinNodes';
import { usePrefersReducedMotion } from './globe/usePrefersReducedMotion';
import { GlobeCanvas } from './GlobeCanvas';
import { GlobeLayers } from './GlobeLayers';
import type { ViewTarget } from './nav/viewNavigation';
import { useOnboardingTrigger } from './onboarding/useOnboardingTrigger';
import { useTimeDriving } from './scrubber/timeDriving';
import { useOpenPermalink } from './story/permalinkLink';

export interface NewsViewProps {
  readonly tier: QualityTier;
  /** AppConfig.historyWindowHours: the scrubber's reach, and the window mock stories span. */
  readonly historyWindowHours: number;
  /** AppConfig.apiBaseUrl, for a story's details. */
  readonly apiBaseUrl: string;
  /** AppConfig.savedStoryLimit. */
  readonly savedStoryLimit: number;
  /** The shared view this page was opened with, if any (see src/core/permalink.ts). */
  readonly link: Permalink;
  /** Ways to sign in, or null when this build has no backend (then there is no Sign in). */
  readonly authProviders: readonly AuthProvider[] | null;
}

/** Which view shows the stories (Prompt 5.1). */
export type NewsViewKind = 'globe' | 'list';

/**
 * The stories and everything over them: the view that shows them, the
 * layers (search, filters, scrubber, sheets) and the dev tools. It owns
 * what the views share: the stories, the motion preference, the camera the
 * search and the sheets move, and the time driving when the globe is not
 * the one drawing.
 */
export function NewsView(props: NewsViewProps): JSX.Element {
  const { tier, historyWindowHours, apiBaseUrl, savedStoryLimit, link, authProviders } = props;
  const settings = renderSettingsForTier(tier);
  const dev = useDevSettings(settings);
  const reducedMotionPreferred = usePrefersReducedMotion();
  const motion = reducedMotionPreferred && !dev.fullMotion ? 'reduced' : 'full';
  const view: NewsViewKind = 'globe';
  const [controls, setControls] = useState<OrbitGlobeControls | null>(null);
  const pinNodes = usePinNodes(dev.pinSource, historyWindowHours);
  const picker = useMemo(() => createPinPicker(), []);
  const selection = useGlobeSelection(controls, picker);
  const storyOpen = useStoryStore((state) => state.sheet !== 'closed');
  const panelOpen = usePanelStore((state) => state.panel !== null);
  const sheetOpen = storyOpen || panelOpen;
  const accountOpen = useAccountStore((state) => state.sheet !== null);
  const inDiscussion = useDiscussionStage((state) => state.phase !== 'closed');
  useOnboardingTrigger(sheetOpen || accountOpen || inDiscussion);
  const target = useMemo(
    (): ViewTarget => ({ camera: controls, viewport: picker.viewport }),
    [controls, picker],
  );
  useLiveClock();
  useOpenPermalink(link, historyWindowHours);
  useTimeDriving(view !== 'globe', historyWindowHours, motion);

  // Dev tooling (and `--mode bench`); production draws without queries.
  const probe = useMemo(
    () => (import.meta.env.DEV || import.meta.env.MODE === 'bench' ? createFrameProbe() : null),
    [],
  );
  const presentLog = useMemo(
    () => (import.meta.env.DEV || import.meta.env.MODE === 'bench' ? createPresentLog() : null),
    [],
  );

  return (
    // Clips what slides off the bottom edge (the scrubber stepping aside, a closed sheet).
    <div className="absolute inset-0 overflow-hidden">
      <GlobeCanvas
        tier={tier}
        settings={settings}
        dev={dev}
        motion={motion}
        nodes={pinNodes}
        picker={picker}
        input={selection.input}
        message={selection.message}
        link={link}
        historyHours={historyWindowHours}
        controls={controls}
        onControls={setControls}
        paused={view !== 'globe'}
        probe={probe}
        presentLog={presentLog}
      />

      <GlobeLayers
        settings={settings}
        view={view}
        nodes={pinNodes}
        target={target}
        globeControls={view === 'globe' ? controls : null}
        apiBaseUrl={apiBaseUrl}
        historyHours={historyWindowHours}
        savedStoryLimit={savedStoryLimit}
        detailsAvailable={dev.pinSource === 'live'}
        reducedMotion={motion === 'reduced'}
        authProviders={authProviders}
        sheetOpen={sheetOpen}
        inDiscussion={inDiscussion}
      />

      {LazyGlobeDevTools && (
        <Suspense fallback={null}>
          <LazyGlobeDevTools
            dev={dev}
            tier={tier}
            settings={settings}
            probe={probe}
            presentLog={presentLog}
            controls={controls}
            reducedMotionPreferred={reducedMotionPreferred}
            historyHours={historyWindowHours}
          />
        </Suspense>
      )}
    </div>
  );
}
