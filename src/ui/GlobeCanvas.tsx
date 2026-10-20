import { Canvas } from '@react-three/fiber';
import { useMemo, useState, type JSX } from 'react';
import { Color } from 'three';

import {
  previewTextureSet,
  textureSetForTier,
  type AuthProvider,
  type Permalink,
  type QualityTier,
} from '@/core';
import { CAMERA_FOV_DEG, renderSettingsForTier, type OrbitGlobeControls } from '@/globe';
import {
  onboardingStore,
  useAccountStore,
  useDiscussionStage,
  usePanelStore,
  useStoryStore,
} from '@/state';

import { stageRecedeNow } from './discussion/stage';
import { createPresentLog } from './globe/bloomReport';
import { ControlsHost, PipelineHost } from './globe/canvasHosts';
import { DiscussionStageHost } from './globe/DiscussionStageHost';
import { REST_FRAME_INTERVAL_MS } from './globe/frameGovernor';
import { createFrameProbe } from './globe/frameProbe';
import { GlobeDevTools } from './globe/GlobeDevTools';
import { GlobeReticle } from './globe/GlobeReticle';
import { GlobeScene } from './globe/GlobeScene';
import { createPinPicker } from './globe/pinPicker';
import { PinScene } from './globe/PinScene';
import { useDevSettings } from './globe/useDevSettings';
import { useGlobeSelection } from './globe/useGlobeSelection';
import { useLiveClock } from './globe/useLiveClock';
import { usePinNodes } from './globe/usePinNodes';
import { usePrefersReducedMotion } from './globe/usePrefersReducedMotion';
import { GlobeLayers } from './GlobeLayers';
import type { GlobeTarget } from './nav/globeNavigation';
import { useOnboardingTrigger } from './onboarding/useOnboardingTrigger';
import { TimeDriver } from './scrubber/TimeDriver';
import { useOpenPermalink } from './story/permalinkLink';

export interface GlobeCanvasProps {
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

/** Matches --color-void, so the opaque canvas is indistinguishable from the page. */
function voidColor(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--color-void');
  return value.trim() || '#05070d';
}

const CAMERA = { fov: CAMERA_FOV_DEG } as const;

/** A 3x phone would fill 2.25x the pixels of 2x for no visible gain on a sphere. */
const DPR_RANGE: [number, number] = [1, 2];

/** Half of what DPR_RANGE gives this screen: the discussion's resting resolution (Prompt 4.5). */
function restDpr(): number {
  return Math.min(DPR_RANGE[1], Math.max(DPR_RANGE[0], window.devicePixelRatio || 1)) / 2;
}

const GLOBE_LABEL =
  'Globe of Earth with news stories as pins, grouped into numbered clusters that open as you zoom in. ' +
  'Drag to rotate, scroll or pinch to zoom, tap a pin to read its story. When focused, arrow keys ' +
  'rotate, plus or minus zoom, Enter opens the story nearest the centre, and Home returns to the ' +
  'resting view.';

/**
 * The one <Canvas> in the app.
 *
 * - frameloop="demand": nothing draws unless something calls invalidate().
 * - The tier decides the frame path (src/globe/renderSettings.ts). With a
 *   composer, canvas MSAA and depth are wasted (the composer has its own
 *   buffers) and r3f must not tone-map (`flat`); without one, r3f's default ACES
 *   is exactly the per-material tone mapping LOW wants.
 * - Cleared to the page colour: bloom and the atmosphere's additive glow have
 *   no meaningful alpha to composite with.
 * - The wrapper is the camera's input surface: focusable, labelled as an
 *   application (it handles its own keys), and touch-action none so the
 *   browser does not pan or zoom the page under a drag or pinch.
 * - dpr capped at 2 (DPR_RANGE), and halved behind a settled discussion
 *   panel. Through this prop, not setDpr: r3f resets anything else to the
 *   prop on its next render.
 */
export function GlobeCanvas(props: GlobeCanvasProps): JSX.Element {
  const { tier, historyWindowHours, apiBaseUrl, savedStoryLimit, link, authProviders } = props;
  const settings = renderSettingsForTier(tier);
  const dev = useDevSettings(settings);
  const [controls, setControls] = useState<OrbitGlobeControls | null>(null);
  const reducedMotionPreferred = usePrefersReducedMotion();
  const pinNodes = usePinNodes(dev.pinSource, historyWindowHours);
  const motion = reducedMotionPreferred && !dev.fullMotion ? 'reduced' : 'full';
  const picker = useMemo(() => createPinPicker(), []);
  const selection = useGlobeSelection(controls, picker);
  const storyOpen = useStoryStore((state) => state.sheet !== 'closed');
  const panelOpen = usePanelStore((state) => state.panel !== null);
  const sheetOpen = storyOpen || panelOpen;
  const accountOpen = useAccountStore((state) => state.sheet !== null);
  const inDiscussion = useDiscussionStage((state) => state.phase !== 'closed');
  const resting = useDiscussionStage(
    (state) => state.phase !== 'closed' && state.quality === 'rest',
  );
  useOnboardingTrigger(sheetOpen || accountOpen || inDiscussion);
  const target = useMemo(
    (): GlobeTarget => ({ controls, viewport: picker.viewport }),
    [controls, picker],
  );
  useLiveClock();
  useOpenPermalink(link, historyWindowHours);

  // Timing is dev tooling; production draws without queries or bookkeeping.
  const probe = useMemo(() => (import.meta.env.DEV ? createFrameProbe() : null), []);
  const presentLog = useMemo(() => (import.meta.env.DEV ? createPresentLog() : null), []);

  // BASE_URL is resolved here, not in src/core, which must not read Vite globals.
  const textures = useMemo(
    () => textureSetForTier(tier, `${import.meta.env.BASE_URL}textures`),
    [tier],
  );
  const previewTextures = useMemo(
    () => previewTextureSet(`${import.meta.env.BASE_URL}textures`),
    [],
  );

  const gl = useMemo(
    () => ({
      antialias: !settings.postprocessing,
      depth: !settings.postprocessing,
      stencil: false,
      powerPreference: 'high-performance' as const,
    }),
    [settings.postprocessing],
  );

  return (
    // Clips what slides off the bottom edge (the scrubber stepping aside, a closed sheet).
    <div className="absolute inset-0 overflow-hidden">
      <Canvas
        frameloop="demand"
        flat={settings.postprocessing}
        dpr={resting ? restDpr() : DPR_RANGE}
        camera={CAMERA}
        gl={gl}
        // scene.background, not setClearColor: three converts a clear colour for
        // whichever target is bound when it is set (the sRGB canvas), and the
        // composer's first clear of its linear buffer reuses those numbers, so the
        // page colour came out sRGB-encoded twice. A background colour is converted
        // per render, for the target actually being drawn.
        onCreated={(state) => {
          state.scene.background = new Color(voidColor());
        }}
        role="application"
        aria-roledescription="globe"
        aria-label={GLOBE_LABEL}
        tabIndex={0}
        // Behind the discussion panel the globe takes no input (Prompt 4.5).
        inert={inDiscussion}
        style={{ touchAction: 'none' }}
        className="peer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        fallback={
          <p className="p-6 text-sm text-muted">
            This globe needs WebGL, which is unavailable in this browser.
          </p>
        }
      >
        <GlobeScene
          textures={textures}
          previewTextures={previewTextures}
          channel={dev.channel}
          cloudsVisible={dev.cloudsVisible}
          atmosphere={dev.atmosphere}
        />
        <TimeDriver historyHours={historyWindowHours} motion={motion} />
        <PinScene
          nodes={pinNodes}
          sourceKey={String(dev.pinSource)}
          visible={dev.pinsVisible}
          motion={motion}
          clustering={dev.clustering}
          picker={picker}
          {...(presentLog ? { onPresent: presentLog.push } : {})}
        />
        <ControlsHost
          motion={motion}
          onReady={setControls}
          input={selection.input}
          initialPose={link.camera}
          restingCenter={onboardingStore.getState().homeCity}
        />
        <DiscussionStageHost controls={controls} />
        <PipelineHost
          settings={settings}
          bloomEnabled={dev.bloomEnabled}
          probe={probe}
          frameIntervalMs={resting ? REST_FRAME_INTERVAL_MS : 0}
          recede={stageRecedeNow}
        />
      </Canvas>
      {/* Straight after the canvas: it shows on the canvas's focus-visible (CSS peer). */}
      <GlobeReticle message={selection.message} />

      <GlobeLayers
        settings={settings}
        nodes={pinNodes}
        target={target}
        controls={controls}
        apiBaseUrl={apiBaseUrl}
        historyHours={historyWindowHours}
        savedStoryLimit={savedStoryLimit}
        detailsAvailable={dev.pinSource === 'live'}
        reducedMotion={motion === 'reduced'}
        authProviders={authProviders}
        sheetOpen={sheetOpen}
        inDiscussion={inDiscussion}
      />

      {/* Inspection tooling only; compiled out of production builds. */}
      {import.meta.env.DEV && (
        <GlobeDevTools
          dev={dev}
          tier={tier}
          settings={settings}
          probe={probe}
          presentLog={presentLog}
          controls={controls}
          reducedMotionPreferred={reducedMotionPreferred}
          historyHours={historyWindowHours}
        />
      )}
    </div>
  );
}
