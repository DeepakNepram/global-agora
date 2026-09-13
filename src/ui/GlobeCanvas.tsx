import { Canvas } from '@react-three/fiber';
import { useMemo, useState, type JSX } from 'react';
import { Color } from 'three';

import { textureSetForTier, type QualityTier } from '@/core';
import { renderSettingsForTier, VIGNETTE, type AtmosphereMode, type EarthChannel } from '@/globe';

import { viewPreset, type ViewPresetId } from './globe/debugControls';
import { createFrameProbe } from './globe/frameProbe';
import { FrameTimeOverlay } from './globe/FrameTimeOverlay';
import { GlobeDebugPanel } from './globe/GlobeDebugPanel';
import { GlobeScene } from './globe/GlobeScene';
import { RenderDebugControls } from './globe/RenderDebugControls';
import { useLiveClock } from './globe/useLiveClock';
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

/**
 * The one <Canvas> in the app.
 *
 * - frameloop="demand": nothing draws unless something calls invalidate().
 * - The tier decides the frame path (src/globe/renderSettings.ts). With a
 *   composer, canvas MSAA and depth are wasted (the composer has its own
 *   buffers) and r3f must not tone-map (`flat`); without one, r3f's default ACES
 *   is exactly the per-material tone mapping LOW wants.
 * - Opaque canvas cleared to the page colour: bloom and the atmosphere's
 *   additive glow have no meaningful alpha to composite with.
 * - dpr capped at 2: a 3x phone would otherwise fill 2.25x the pixels of 2x
 *   for no visible gain on a sphere.
 */
export function GlobeCanvas({ tier }: GlobeCanvasProps): JSX.Element {
  const settings = renderSettingsForTier(tier);
  const [view, setView] = useState<ViewPresetId>('primeMeridian');
  const [channel, setChannel] = useState<EarthChannel>('lit');
  const [cloudsVisible, setCloudsVisible] = useState(true);
  const [atmosphere, setAtmosphere] = useState<AtmosphereMode>(settings.atmosphere);
  const [bloomEnabled, setBloomEnabled] = useState(settings.bloom);
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
      alpha: false,
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
        camera={{ fov: 35, near: 0.1, far: 100, position: [4, 0, 0] }}
        gl={gl}
        // scene.background, not setClearColor: three converts a clear colour for
        // whichever target is bound when it is set (the sRGB canvas), and the
        // composer's first clear of its linear buffer reuses those numbers, so the
        // page colour came out sRGB-encoded twice. A background colour is converted
        // per render, for the target actually being drawn.
        onCreated={(state) => {
          state.scene.background = new Color(voidColor());
        }}
        role="img"
        aria-label="Globe of Earth"
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
          view={viewPreset(view).at}
        />
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
          view={view}
          onViewChange={setView}
          channel={channel}
          onChannelChange={setChannel}
          cloudsVisible={cloudsVisible}
          onCloudsVisibleChange={setCloudsVisible}
        >
          <RenderDebugControls
            atmosphere={atmosphere}
            onAtmosphereChange={setAtmosphere}
            bloomEnabled={bloomEnabled}
            onBloomEnabledChange={setBloomEnabled}
            bloomAvailable={settings.postprocessing}
          />
        </GlobeDebugPanel>
      )}
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
