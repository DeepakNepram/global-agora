import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type JSX } from 'react';
import { Color } from 'three';

import {
  previewTextureSet,
  textureSetForTier,
  type NodeBuffer,
  type Permalink,
  type QualityTier,
} from '@/core';
import {
  CAMERA_FOV_DEG,
  type MotionPreference,
  type OrbitGlobeControls,
  type RenderSettings,
} from '@/globe';
import { onboardingStore, useDiscussionStage } from '@/state';

import { stageRecedeNow } from './discussion/stage';
import type { PresentLog } from './globe/bloomReport';
import { ControlsHost, PipelineHost } from './globe/canvasHosts';
import { DiscussionStageHost } from './globe/DiscussionStageHost';
import { REST_FRAME_INTERVAL_MS } from './globe/frameGovernor';
import type { FrameProbe } from './globe/frameProbe';
import { GlobeReticle } from './globe/GlobeReticle';
import { GlobeScene } from './globe/GlobeScene';
import type { GlobeInputHandlers } from './globe/bindControlInput';
import { PinFocusRing, PinFocusTracker } from './globe/PinFocusRing';
import type { PinPicker } from './globe/pinPicker';
import { PinScene } from './globe/PinScene';
import type { DevSettings } from './globe/useDevSettings';
import type { FocusedPin } from './globe/usePinFocus';
import { TimeDriver } from './scrubber/TimeDriver';

export interface GlobeCanvasProps {
  readonly tier: QualityTier;
  readonly settings: RenderSettings;
  readonly dev: DevSettings;
  readonly motion: MotionPreference;
  readonly nodes: NodeBuffer | null;
  readonly picker: PinPicker;
  /** Taps, Enter, Escape and Home on the globe. */
  readonly input: GlobeInputHandlers;
  /** What the last keyboard move did, read out politely. */
  readonly message: string;
  /** The pin Tab has landed on, which the focus ring follows. */
  readonly focused: FocusedPin | null;
  /** The shared view this page was opened with, if any. */
  readonly link: Permalink;
  readonly historyHours: number;
  readonly controls: OrbitGlobeControls | null;
  readonly onControls: (controls: OrbitGlobeControls | null) => void;
  /** The list is showing (Prompt 5.1): the globe keeps its state but draws nothing and takes no input. */
  readonly paused: boolean;
  /** A modal sheet is up over it: no input. */
  readonly covered: boolean;
  readonly probe: FrameProbe | null;
  readonly presentLog: PresentLog | null;
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
  'Drag to rotate, scroll or pinch to zoom, tap a pin to read its story. When focused, Tab goes ' +
  'through the pins in view, nearest the centre first, and Enter opens the one with the ring; ' +
  'arrow keys rotate, plus or minus zoom, and Home returns to the resting view. The list view ' +
  'shows every story as a list.';

/** Draws the frame the globe missed while paused: nothing else asks for one. */
function ResumeHost({ paused }: { readonly paused: boolean }): null {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (!paused) invalidate();
  }, [paused, invalidate]);
  return null;
}

/**
 * The one <Canvas> in the app.
 *
 * - frameloop="demand": nothing draws unless something calls invalidate();
 *   "never" while the list covers it, so Play draws no hidden frames.
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
  const { tier, settings, dev, motion, nodes, picker, paused, probe, presentLog, focused } = props;
  const ring = useRef<HTMLDivElement>(null);
  const inDiscussion = useDiscussionStage((state) => state.phase !== 'closed');
  const resting = useDiscussionStage(
    (state) => state.phase !== 'closed' && state.quality === 'rest',
  );

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
    <div className={`absolute inset-0 ${paused ? 'invisible' : ''}`}>
      <Canvas
        frameloop={paused ? 'never' : 'demand'}
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
        // Behind the discussion panel, or under the list, the globe takes no input.
        inert={inDiscussion || paused || props.covered}
        style={{ touchAction: 'none' }}
        className="peer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        fallback={
          <p className="p-6 text-sm text-muted">
            This globe needs WebGL, which is unavailable in this browser. The list view shows every
            story.
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
        <TimeDriver historyHours={props.historyHours} motion={motion} />
        <PinScene
          nodes={nodes}
          sourceKey={String(dev.pinSource)}
          visible={dev.pinsVisible}
          motion={motion}
          clustering={dev.clustering}
          picker={picker}
          {...(presentLog ? { onPresent: presentLog.push } : {})}
        />
        <ControlsHost
          motion={motion}
          onReady={props.onControls}
          input={props.input}
          initialPose={props.link.camera}
          restingCenter={onboardingStore.getState().homeCity}
        />
        <DiscussionStageHost controls={props.controls} />
        <PipelineHost
          settings={settings}
          bloomEnabled={dev.bloomEnabled}
          probe={probe}
          frameIntervalMs={resting ? REST_FRAME_INTERVAL_MS : 0}
          recede={stageRecedeNow}
        />
        <ResumeHost paused={paused} />
        <PinFocusTracker row={focused?.target.row ?? null} ring={ring} picker={picker} />
      </Canvas>
      {/* After the canvas: they show on the canvas's focus-visible (CSS peer). */}
      <GlobeReticle message={props.message} pinFocused={focused !== null} />
      <PinFocusRing ring={ring} focused={focused} />
    </div>
  );
}
