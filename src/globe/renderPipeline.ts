import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from 'postprocessing';
import {
  ACESFilmicToneMapping,
  HalfFloatType,
  NoToneMapping,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';

import { BLOOM_THRESHOLD } from './hdr';
import type { RenderSettings } from './renderSettings';

/**
 * Vignette strength. Exported so a host that draws its own vignette (the LOW
 * tier, which has no composer) can match it.
 */
export const VIGNETTE = { offset: 0.3, darkness: 0.3 } as const;

export interface RenderPipeline {
  /** Draws one frame. The host calls this instead of renderer.render. */
  render(deltaSeconds: number): void;
  /** Call after the renderer's size or pixel ratio changes. */
  setSize(width: number, height: number): void;
  /** No-op without a composer: LOW never blooms. */
  setBloomEnabled(enabled: boolean): void;
  dispose(): void;
}

function createEffects(settings: RenderSettings, bloom: boolean): Effect[] {
  const effects: Effect[] = [];
  if (bloom) {
    effects.push(
      new BloomEffect({
        // smoothstep(threshold, threshold + smoothing, luminance): white stays out.
        luminanceThreshold: BLOOM_THRESHOLD,
        luminanceSmoothing: 0.25,
        mipmapBlur: true,
        intensity: 0.8,
        radius: 0.6,
        resolutionScale: settings.bloomResolutionScale,
      }),
    );
  }
  // Order matters: bloom adds HDR light, ACES maps it to display range, and
  // the vignette darkens the result.
  effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
  effects.push(new VignetteEffect(VIGNETTE));
  return effects;
}

/**
 * The frame path for a tier.
 *
 * Without postprocessing the renderer draws straight to the canvas with ACES
 * applied per material (three's tonemapping_fragment): no extra pass, no extra
 * render target. With it, the scene goes to a half-float MSAA buffer so city
 * lights can exceed 1.0, then one merged EffectPass does bloom, ACES and the
 * vignette in a single full-screen draw.
 */
export function createRenderPipeline(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  settings: RenderSettings,
): RenderPipeline {
  if (!settings.postprocessing) {
    renderer.toneMapping = ACESFilmicToneMapping;
    return {
      render: () => renderer.render(scene, camera),
      setSize() {},
      setBloomEnabled() {},
      dispose() {},
    };
  }

  // Tone mapping moves into the composer; applying it in materials too would
  // compress twice.
  renderer.toneMapping = NoToneMapping;
  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
    multisampling: settings.multisampling,
  });
  composer.addPass(new RenderPass(scene, camera));

  let effectPass: EffectPass | null = null;
  let bloomEnabled: boolean | null = null;

  const setBloomEnabled = (enabled: boolean): void => {
    if (enabled === bloomEnabled) return;
    bloomEnabled = enabled;
    if (effectPass) {
      composer.removePass(effectPass);
      // Disposes its effects too, so the next pass is built from fresh ones.
      effectPass.dispose();
    }
    effectPass = new EffectPass(camera, ...createEffects(settings, enabled));
    composer.addPass(effectPass);
  };
  setBloomEnabled(settings.bloom);

  return {
    render: (deltaSeconds) => composer.render(deltaSeconds),
    setSize: (width, height) => composer.setSize(width, height, false),
    setBloomEnabled,
    dispose: () => composer.dispose(),
  };
}
