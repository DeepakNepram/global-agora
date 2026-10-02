import { Canvas } from '@react-three/fiber';
import { useMemo, useState, type JSX } from 'react';
import { Color } from 'three';

import { previewTextureSet, textureSetForTier, type Permalink, type QualityTier } from '@/core';
import { CAMERA_FOV_DEG, renderSettingsForTier, VIGNETTE, type OrbitGlobeControls } from '@/globe';
import { onboardingStore, usePanelStore, useStoryStore } from '@/state';

import { createPresentLog } from './globe/bloomReport';
import { ControlsHost, PipelineHost } from './globe/canvasHosts';
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
import { vignetteCssGradient } from './globe/vignette';
import { SecondarySheets } from './SecondarySheets';
import { LibraryButtons } from './library/LibraryButtons';
import type { GlobeTarget } from './nav/globeNavigation';
import { NavLayer } from './nav/NavLayer';
import { useOnboardingTrigger } from './onboarding/useOnboardingTrigger';
import { TimeDriver } from './scrubber/TimeDriver';
import { TimeScrubber } from './scrubber/TimeScrubber';
import { useOpenPermalink } from './story/permalinkLink';
import { StoryLayer } from './story/StoryLayer';

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
}

/** Matches --color-void, so the opaque canvas is indistinguishable from the page. */
function voidColor(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--color-void');
  return value.trim() || '#05070d';
}

const CAMERA = { fov: CAMERA_FOV_DEG } as const;

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
 * - dpr capped at 2: a 3x phone would otherwise fill 2.25x the pixels of 2x
 *   for no visible gain on a sphere.
 */
export function GlobeCanvas(props: GlobeCanvasProps): JSX.Element {
  const { tier, historyWindowHours, apiBaseUrl, savedStoryLimit, link } = props;
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
  useOnboardingTrigger(sheetOpen);
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
        dpr={[1, 2]}
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
        <PipelineHost settings={settings} bloomEnabled={dev.bloomEnabled} probe={probe} />
      </Canvas>
      {/* Straight after the canvas: it shows on the canvas's focus-visible (CSS peer). */}
      <GlobeReticle message={selection.message} />

      {!settings.postprocessing && (
        // LOW has no composer; a CSS vignette matching VignetteEffect costs no GPU pass.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: vignetteCssGradient(VIGNETTE) }}
        />
      )}

      <NavLayer
        nodes={pinNodes}
        target={target}
        apiBaseUrl={apiBaseUrl}
        historyHours={historyWindowHours}
        actions={<LibraryButtons />}
      />
      <TimeScrubber nodes={pinNodes} historyHours={historyWindowHours} hidden={sheetOpen} />
      <SecondarySheets
        nodes={pinNodes}
        target={target}
        historyHours={historyWindowHours}
        savedStoryLimit={savedStoryLimit}
        reducedMotion={motion === 'reduced'}
      />
      <StoryLayer
        nodes={pinNodes}
        controls={controls}
        apiBaseUrl={apiBaseUrl}
        savedStoryLimit={savedStoryLimit}
        detailsAvailable={dev.pinSource === 'live'}
        reducedMotion={motion === 'reduced'}
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
