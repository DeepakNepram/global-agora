import { HalfFloatType, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';

import { RecedeEffect, recedeLook } from './recede';

describe('recedeLook', () => {
  it('is the globe as normal at 0', () => {
    expect(recedeLook(0)).toEqual({
      blurMix: 0,
      blurScalePerDpr: 0,
      desaturation: 0,
      dim: 0,
      bloomScale: 1,
    });
  });

  it('is fully behind the panel at 1', () => {
    expect(recedeLook(1)).toEqual({
      blurMix: 1,
      blurScalePerDpr: 0.5,
      desaturation: 0.8,
      dim: 0.3,
      bloomScale: 0.5,
    });
  });

  it('grows the blur radius steadily while the blurred image is already in', () => {
    // A cross-fade between sharp and blurred would read as a double image;
    // the mix is complete early and the radius carries the rest.
    expect(recedeLook(0.2).blurMix).toBe(1);
    expect(recedeLook(0.2).blurScalePerDpr).toBeCloseTo(0.1, 12);
    let previous = recedeLook(0);
    for (let a = 0.05; a <= 1; a += 0.05) {
      const look = recedeLook(a);
      expect(look.blurScalePerDpr).toBeGreaterThan(previous.blurScalePerDpr);
      expect(look.blurMix).toBeGreaterThanOrEqual(previous.blurMix);
      previous = look;
    }
  });

  it('clamps nonsense to the ends', () => {
    expect(recedeLook(-1)).toEqual(recedeLook(0));
    expect(recedeLook(7)).toEqual(recedeLook(1));
    expect(recedeLook(Number.NaN)).toEqual(recedeLook(0));
  });
});

describe('RecedeEffect', () => {
  /** A renderer that fails the test if anything draws. */
  const untouchable = new Proxy({} as WebGLRenderer, {
    get(_target, key) {
      throw new Error(`renderer.${String(key)} used at amount 0`);
    },
  });

  it('draws nothing while the globe is as normal', () => {
    const effect = new RecedeEffect();
    effect.setAmount(0);
    expect(() => effect.update(untouchable, new WebGLRenderTarget(4, 4))).not.toThrow();
    expect(effect.uniforms.get('blurMix')?.value).toBe(0);
  });

  it('sets its uniforms from the look', () => {
    const effect = new RecedeEffect();
    effect.setAmount(0.5);
    const look = recedeLook(0.5);
    expect(effect.uniforms.get('blurMix')?.value).toBe(look.blurMix);
    expect(effect.uniforms.get('desaturation')?.value).toBe(look.desaturation);
    expect(effect.uniforms.get('dim')?.value).toBe(look.dim);
    expect(effect.uniforms.get('blurBuffer')?.value).not.toBeNull();
  });

  it('keeps the blur in half float, like the scene buffer', () => {
    const effect = new RecedeEffect();
    effect.initialize(untouchableInit(), false, HalfFloatType);
    expect((effect.uniforms.get('blurBuffer')?.value as { type: number }).type).toBe(HalfFloatType);
  });
});

/** KawaseBlurPass.initialize reads the renderer's output colour space only for 8-bit buffers. */
function untouchableInit(): WebGLRenderer {
  return {} as WebGLRenderer;
}
