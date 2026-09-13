import { describe, expect, it } from 'vitest';

import { VIGNETTE } from '@/globe';

import { vignetteCssGradient, vignetteFactor } from './vignette';

describe('vignetteFactor', () => {
  it('leaves the centre untouched and darkens toward the corners', () => {
    expect(vignetteFactor(0, VIGNETTE)).toBe(1);
    const edge = vignetteFactor(0.5, VIGNETTE);
    const corner = vignetteFactor(Math.SQRT1_2, VIGNETTE);
    expect(edge).toBeLessThanOrEqual(1);
    expect(corner).toBeLessThan(edge);
  });

  it('stays light: corners keep most of their brightness', () => {
    // "A light vignette" (Prompt 1.3). Guards against a tweak that turns it heavy.
    expect(vignetteFactor(Math.SQRT1_2, VIGNETTE)).toBeGreaterThan(0.6);
  });
});

describe('vignetteCssGradient', () => {
  it('is an elliptical gradient with alpha rising outward', () => {
    const css = vignetteCssGradient(VIGNETTE);
    expect(css.startsWith('radial-gradient(ellipse 50% 50% at 50% 50%, ')).toBe(true);
    const alphas = [...css.matchAll(/rgba\(0, 0, 0, ([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(alphas.length).toBeGreaterThan(2);
    expect(alphas[0]).toBe(0);
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]).toBeGreaterThanOrEqual(alphas[i - 1]!);
    }
  });
});
