import { Canvas } from '@react-three/fiber';
import { useMemo, useState, type JSX } from 'react';
import { Color } from 'three';

import { textureSetForTier, type QualityTier } from '@/core';
import {
  CAMERA_FOV_DEG,
  renderSettingsForTier,
  VIGNETTE,
  type AtmosphereMode,
  type EarthChannel,
  type OrbitGlobeControls,
} from '@/globe';

import { CameraDebugControls } from './globe/CameraDebugControls';
import { CameraOverlay } from './globe/CameraOverlay';
import { createFrameProbe } from './globe/frameProbe';
import { FrameTimeOverlay } from './globe/FrameTimeOverlay';
import { GlobeDebugPanel } from './globe/GlobeDebugPanel';
import { GlobeScene } from './globe/GlobeScene';
import { RenderDebugControls } from './globe/RenderDebugControls';
import { useGlobeControls, type GlobeControlsOptions } from './globe/useGlobeControls';
import { useLiveClock } from './globe/useLiveClock';
import { usePrefersReducedMotion } from './globe/usePrefersReducedMotion';
import { useRenderPipeline, type RenderPipelineOptions } from './globe/useRenderPipeline';
import { vignetteCssGradient } from './globe/vignette';

export interface GlobeCanvasProps {
  readonly tier: QualityTier;
}

/** Matches --color-void, so the opaque canvas is indistinguishable from the page. */
function voidColor(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--color-void');
  return value.trim() || '#05070d';
}

function PipelineHost(props: RenderPipelineOptions): null {
  useRenderPipeline(props);
  return null;
}

function ControlsHost(props: GlobeControlsOptions): null {
  useGlobeControls(props);
  return null;
}

const CAMERA = { fov: CAMERA_FOV_DEG } as const;

const GLOBE_LABEL =
  'Globe of Earth. Drag to rotate, scroll or pinch to zoom. When focused, arrow keys rotate and plus or minus zoom.';

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
export function GlobeCanvas({ tier }: GlobeCanvasProps): JSX.Element {
  const settings = renderSettingsForTier(tier);
  const [channel, setChannel] = useState<EarthChannel>('lit');
  const [cloudsVisible, setCloudsVisible] = useState(true);
  const [atmosphere, setAtmosphere] = useState<AtmosphereMode>(settings.atmosphere);
  const [bloomEnabled, setBloomEnabled] = useState(settings.bloom);
  const [controls, setControls] = useState<OrbitGlobeControls | null>(null);
  const reducedMotionPreferred = usePrefersReducedMotion();
  const [fullMotion, setFullMotion] = useState(false);
  const motion = reducedMotionPreferred && !fullMotion ? 'reduced' : 'full';
  useLiveClock();

  // Timing is dev tooling; production draws without queries or bookkeeping.
  const probe = useMemo(() => (import.meta.env.DEV ? createFrameProbe() : null), []);

  // BASE_URL is resolved here, not in src/core, which must not read Vite globals.
  const textures = useMemo(
    () => textureSetForTier(tier, `${import.meta.env.BASE_URL}textures`),
    [tier],
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
    <div className="absolute inset-0">
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
        className="focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        fallback={
          <p className="p-6 text-sm text-muted">
            This globe needs WebGL, which is unavailable in this browser.
          </p>
        }
      >
        <GlobeScene
          textures={textures}
          channel={channel}
          cloudsVisible={cloudsVisible}
          atmosphere={atmosphere}
        />
        <ControlsHost motion={motion} onReady={setControls} />
        <PipelineHost settings={settings} bloomEnabled={bloomEnabled} probe={probe} />
      </Canvas>

      {!settings.postprocessing && (
        // LOW has no composer; a CSS vignette matching VignetteEffect costs no GPU pass.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: vignetteCssGradient(VIGNETTE) }}
        />
      )}

      {/* Inspection tooling only; compiled out of production builds. */}
      {import.meta.env.DEV && (
        <GlobeDebugPanel
          channel={channel}
          onChannelChange={setChannel}
          cloudsVisible={cloudsVisible}
          onCloudsVisibleChange={setCloudsVisible}
        >
          <CameraDebugControls
            controls={controls}
            reducedMotionPreferred={reducedMotionPreferred}
            fullMotion={fullMotion}
            onFullMotionChange={setFullMotion}
          />
          <RenderDebugControls
            atmosphere={atmosphere}
            onAtmosphereChange={setAtmosphere}
            bloomEnabled={bloomEnabled}
            onBloomEnabledChange={setBloomEnabled}
            bloomAvailable={settings.postprocessing}
          />
        </GlobeDebugPanel>
      )}
      {import.meta.env.DEV && controls && <CameraOverlay controls={controls} />}
      {import.meta.env.DEV && probe && (
        <FrameTimeOverlay
          probe={probe}
          tier={tier}
          atmosphere={atmosphere}
          bloomEnabled={settings.postprocessing && bloomEnabled}
        />
      )}
    </div>
  );
}
