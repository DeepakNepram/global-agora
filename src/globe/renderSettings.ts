import type { QualityTier } from '@/core';

/** `rim`: analytic Fresnel halo. `scattering`: few-sample in-scatter march. */
export type AtmosphereMode = 'rim' | 'scattering';

export interface RenderSettings {
  readonly atmosphere: AtmosphereMode;
  /**
   * Whether frames go through the effect composer at all. Without it there is
   * no bloom, ACES is applied inside each material by three, and the vignette
   * is left to the host (a CSS overlay costs no GPU pass).
   */
  readonly postprocessing: boolean;
  readonly bloom: boolean;
  /** Bloom's internal resolution relative to the drawing buffer. */
  readonly bloomResolutionScale: number;
  /** MSAA samples in the composer's scene buffer. Canvas MSAA is used otherwise. */
  readonly multisampling: number;
}

const SETTINGS: Record<QualityTier, RenderSettings> = {
  // Weak GPUs and software rasterisers: no extra passes, no extra targets.
  low: {
    atmosphere: 'rim',
    postprocessing: false,
    bloom: false,
    bloomResolutionScale: 0,
    multisampling: 0,
  },
  // Mid-range Android lands here (30fps budget). Bloom at half resolution; the
  // mip-blur's cost scales with that buffer, not with the canvas.
  medium: {
    atmosphere: 'rim',
    postprocessing: true,
    bloom: true,
    bloomResolutionScale: 0.5,
    multisampling: 4,
  },
  high: {
    atmosphere: 'scattering',
    postprocessing: true,
    bloom: true,
    bloomResolutionScale: 1,
    multisampling: 4,
  },
};

export function renderSettingsForTier(tier: QualityTier): RenderSettings {
  return SETTINGS[tier];
}
