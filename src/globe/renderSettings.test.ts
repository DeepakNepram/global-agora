import { describe, expect, it } from 'vitest';

import { QUALITY_TIERS } from '@/core';

import { renderSettingsForTier } from './renderSettings';

describe('renderSettingsForTier', () => {
  it('gives LOW no composer and no bloom (Prompt 1.3)', () => {
    expect(renderSettingsForTier('low')).toMatchObject({
      atmosphere: 'rim',
      postprocessing: false,
      bloom: false,
    });
  });

  it('uses the rim on MEDIUM and scattering only on HIGH', () => {
    expect(renderSettingsForTier('medium').atmosphere).toBe('rim');
    expect(renderSettingsForTier('high').atmosphere).toBe('scattering');
  });

  it.each(QUALITY_TIERS)('%s is internally consistent', (tier) => {
    const s = renderSettingsForTier(tier);
    if (s.bloom) {
      expect(s.postprocessing).toBe(true);
      expect(s.bloomResolutionScale).toBeGreaterThan(0);
      expect(s.bloomResolutionScale).toBeLessThanOrEqual(1);
    }
    if (!s.postprocessing) expect(s.multisampling).toBe(0);
  });

  it('never gives a lower tier more bloom work than a higher one', () => {
    const [low, medium, high] = QUALITY_TIERS.map(renderSettingsForTier);
    expect(low!.bloomResolutionScale).toBeLessThanOrEqual(medium!.bloomResolutionScale);
    expect(medium!.bloomResolutionScale).toBeLessThanOrEqual(high!.bloomResolutionScale);
  });
});
