import { Suspense, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import type { AuthProvider, Permalink, QualityTier } from '@/core';
import { renderSettingsForTier, type OrbitGlobeControls } from '@/globe';
import {
  useAccountStore,
  useDiscussionStage,
  usePanelStore,
  useStoryStore,
  useViewStore,
  viewStore,
} from '@/state';

import { FlatMap } from './flatmap/FlatMap';
import type { FlatControls } from './flatmap/flatCamera';
import { useModalSheetOpen } from './focus/useModal';
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
import { StoryList } from './list/StoryList';
import type { ViewCamera, ViewTarget } from './nav/viewNavigation';
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

/**
 * Which view shows the stories (Prompt 5.1): the globe, or under reduced
 * motion the flat map, or the list.
 */
export type NewsViewKind = 'globe' | 'map' | 'list';

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
  const layout = useViewStore((state) => state.layout);
  // Under reduced motion the globe is a flat map: no flights, no inertia, no pulse.
  const visual: 'globe' | 'map' = motion === 'reduced' ? 'map' : 'globe';
  const view: NewsViewKind = layout === 'list' ? 'list' : visual;
  // Each mounts the first time it is wanted: a reader who keeps to the list
  // never pays for the globe's textures and GPU context.
  const [used, setUsed] = useState({ globe: view === 'globe', map: view === 'map' });
  if (layout === 'visual' && !used[visual]) setUsed({ ...used, [visual]: true });
  const [controls, setControls] = useState<OrbitGlobeControls | null>(null);
  const [mapCamera, setMapCamera] = useState<FlatControls | null>(null);
  const visualCamera: ViewCamera | null = visual === 'map' ? mapCamera : controls;
  const camera = view === 'list' ? null : visualCamera;
  const pendingFly = useRef<((camera: ViewCamera) => void) | null>(null);
  const pinNodes = usePinNodes(dev.pinSource, historyWindowHours);
  const picker = useMemo(() => createPinPicker(), []);
  const selection = useGlobeSelection(visualCamera, picker, pinNodes);
  const storyOpen = useStoryStore((state) => state.sheet !== 'closed');
  const panelOpen = usePanelStore((state) => state.panel !== null);
  const sheetOpen = storyOpen || panelOpen;
  const accountOpen = useAccountStore((state) => state.sheet !== null);
  const inDiscussion = useDiscussionStage((state) => state.phase !== 'closed');
  const covered = useModalSheetOpen();
  useOnboardingTrigger(sheetOpen || accountOpen || inDiscussion);
  const target = useMemo(
    (): ViewTarget => ({
      camera,
      viewport: picker.viewport,
      showVisual: (then) => {
        pendingFly.current = then;
        viewStore.getState().setLayout('visual');
      },
    }),
    [camera, picker],
  );

  // A place chosen from the list's search goes to the map once it is up.
  useEffect(() => {
    const fly = pendingFly.current;
    if (!camera || !fly) return;
    pendingFly.current = null;
    fly(camera);
  }, [camera]);

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
      {used.globe && visual === 'globe' && (
        <GlobeCanvas
          tier={tier}
          settings={settings}
          dev={dev}
          motion={motion}
          nodes={pinNodes}
          picker={picker}
          input={selection.input}
          message={selection.message}
          focused={selection.focused}
          link={link}
          historyHours={historyWindowHours}
          controls={controls}
          onControls={setControls}
          paused={view !== 'globe'}
          covered={covered}
          probe={probe}
          presentLog={presentLog}
        />
      )}
      {used.map && visual === 'map' && (
        <FlatMap
          tier={tier}
          nodes={pinNodes}
          clustering={dev.clustering}
          picker={picker}
          input={selection.input}
          message={selection.message}
          focused={selection.focused}
          link={link}
          onCamera={setMapCamera}
          paused={view !== 'map'}
          covered={covered}
        />
      )}

      {/* In the main chunk on purpose: as a lazy chunk, the bundler split React,
          zustand and the stores out of it into three startup files (DECISIONS). */}
      {view === 'list' && <StoryList nodes={pinNodes} covered={inDiscussion || covered} />}

      <GlobeLayers
        settings={settings}
        view={view}
        visualLabel={visual === 'map' ? 'Map' : 'Globe'}
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
