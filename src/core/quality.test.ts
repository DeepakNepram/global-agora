import { describe, expect, it } from 'vitest';

import {
  decideTier,
  parseTierOverride,
  pickTier,
  textureWidthForTier,
  type DeviceCapabilities,
} from './quality';

/** A capable desktop. Each test overrides only the property under examination. */
function caps(overrides: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    maxTextureSize: 16384,
    rendererDescription: 'ANGLE (NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
    deviceMemoryGb: 8,
    hardwareConcurrency: 16,
    screenWidth: 2560,
    screenHeight: 1440,
    devicePixelRatio: 1,
    ...overrides,
  };
}

describe('pickTier — low', () => {
  it('drops to low when the GPU cannot upload a 4K texture', () => {
    expect(pickTier(caps({ maxTextureSize: 2048 }))).toBe('low');
  });

  it.each([
    ['SwiftShader', 'Google SwiftShader'],
    ['llvmpipe', 'Mesa/X.org llvmpipe (LLVM 15.0.6, 256 bits)'],
    ['Microsoft Basic', 'Microsoft Basic Render Driver'],
  ])('drops to low on a software renderer (%s)', (_label, renderer) => {
    expect(pickTier(caps({ rendererDescription: renderer }))).toBe('low');
  });

  it('drops to low on 2GB of device memory', () => {
    expect(pickTier(caps({ deviceMemoryGb: 2 }))).toBe('low');
  });

  it.each([
    ['Mali-400 MP', 'Mali-400 MP'],
    ['Mali-T720', 'Mali-T720'],
    ['Adreno 306', 'Adreno (TM) 306'],
    ['PowerVR SGX', 'PowerVR SGX 544MP'],
  ])('drops to low on a known-weak GPU (%s)', (_label, renderer) => {
    expect(pickTier(caps({ rendererDescription: renderer }))).toBe('low');
  });
});

describe('pickTier — medium', () => {
  it('caps at medium when the GPU tops out below 8K', () => {
    expect(pickTier(caps({ maxTextureSize: 4096 }))).toBe('medium');
  });

  it('caps at medium on 4GB of device memory', () => {
    expect(pickTier(caps({ deviceMemoryGb: 4 }))).toBe('medium');
  });

  it('caps at medium on four logical cores', () => {
    expect(pickTier(caps({ hardwareConcurrency: 4 }))).toBe('medium');
  });

  it('caps a mid-range Android at medium even when it reports 8K support', () => {
    // The budget is 30fps here (CLAUDE.md). This is the case the whole tier
    // system exists for: capable enough to claim 8K, not to sustain it.
    const midRangeAndroid = caps({
      maxTextureSize: 16384,
      rendererDescription: 'Adreno (TM) 619',
      deviceMemoryGb: 6,
      hardwareConcurrency: 8,
      screenWidth: 393,
      screenHeight: 851,
      devicePixelRatio: 2.75,
    });
    expect(pickTier(midRangeAndroid)).toBe('medium');
  });

  it('caps at medium on a small display, where an 8K set is wasted VRAM', () => {
    expect(pickTier(caps({ screenWidth: 1280, screenHeight: 720 }))).toBe('medium');
  });
});

describe('pickTier — high', () => {
  it('returns high for a capable desktop', () => {
    expect(pickTier(caps())).toBe('high');
  });

  it('does not punish a device that simply does not report deviceMemory', () => {
    // Safari and Firefox do not implement navigator.deviceMemory. Treating the
    // absent value as "small" would demote every Mac and Firefox user.
    expect(pickTier(caps({ deviceMemoryGb: null }))).toBe('high');
  });

  it('does not punish a missing hardwareConcurrency', () => {
    expect(pickTier(caps({ hardwareConcurrency: null }))).toBe('high');
  });

  it('treats a retina display by physical pixels, not CSS pixels', () => {
    expect(pickTier(caps({ screenWidth: 1512, screenHeight: 982, devicePixelRatio: 2 }))).toBe(
      'high',
    );
  });
});

describe('manual override', () => {
  it('forces a tier that automatic detection would not have chosen', () => {
    const weak = caps({ rendererDescription: 'Google SwiftShader' });
    expect(pickTier(weak)).toBe('low');
    expect(pickTier(weak, 'high')).toBe('high');
  });

  it('forces downward too', () => {
    expect(pickTier(caps(), 'low')).toBe('low');
  });

  it('is still clamped by MAX_TEXTURE_SIZE, since that is a hard limit', () => {
    const decision = decideTier(caps({ maxTextureSize: 4096 }), 'high');
    expect(decision.tier).toBe('medium');
    expect(decision.reason).toContain('capped');
  });

  it('records that the choice was forced', () => {
    expect(decideTier(caps(), 'low').reason).toContain('override');
  });
});

describe('parseTierOverride', () => {
  it.each(['low', 'medium', 'high'])('accepts %s', (value) => {
    expect(parseTierOverride(value)).toBe(value);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseTierOverride('  HIGH \n')).toBe('high');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['unknown word', 'ultra'],
    ['a number', '4096'],
  ])('rejects %s by falling back to automatic detection', (_label, value) => {
    expect(parseTierOverride(value)).toBeNull();
  });
});

describe('textureWidthForTier', () => {
  it('maps tiers onto the widths the build script emits', () => {
    expect(textureWidthForTier('low')).toBe(2048);
    expect(textureWidthForTier('medium')).toBe(4096);
    expect(textureWidthForTier('high')).toBe(8192);
  });
});

describe('unmeasurable signals', () => {
  it('does not demote when the display cannot be measured', () => {
    // Regression: some embedded webviews report screen 0x0. Treating that as a
    // small display capped a 16GB/20-core desktop at medium with the nonsense
    // reason "small display (0k physical pixels)".
    const decision = decideTier(caps({ screenWidth: 0, screenHeight: 0 }));
    expect(decision.tier).toBe('high');
    expect(decision.reason).not.toContain('0k');
  });

  it('still demotes when the display is measurable and genuinely small', () => {
    const decision = decideTier(caps({ screenWidth: 1280, screenHeight: 720 }));
    expect(decision.tier).toBe('medium');
    expect(decision.reason).toContain('small display');
  });

  it('survives a zero devicePixelRatio', () => {
    expect(pickTier(caps({ devicePixelRatio: 0 }))).toBe('high');
  });
});
