import { describe, expect, it } from 'vitest';

import { CATEGORY_SHAPES, NEWS_CATEGORIES, SHAPE_KINDS, shapeReach } from '@/core';

import { PIN_FRAG } from './pinFragment.glsl';
import {
  ORB_MARK_CENTRE,
  ORB_MARK_RADIUS,
  ORB_REACH,
  PIN_REACH,
  PIN_SHAPE_OF_VERT,
  PIN_SHAPES_FRAG,
} from './pinShapes.glsl';
import { PIN_VERT } from './pinVertex.glsl';
import {
  BADGE_INK,
  CATEGORY_HUES,
  CORE_RADIUS,
  ORB_CORE_RADIUS,
  SELECTION_QUAD_SCALE,
} from './pinStyle';

describe('pin shapes on the GPU', () => {
  it('has one distance branch per shape, in SHAPE_KINDS order', () => {
    const branches = PIN_SHAPES_FRAG.match(
      /return (length\(p\) - 1\.0|sdPlus\([^;]*\)|sdRadial\(p,[^)]*\));/g,
    );
    expect(branches).toHaveLength(SHAPE_KINDS.length);
    expect(branches?.[0]).toContain('length(p)');
    expect(branches?.[SHAPE_KINDS.indexOf('plus')]).toContain('sdPlus');
  });

  it('maps every category to its shape index', () => {
    NEWS_CATEGORIES.forEach((category, i) => {
      const index = SHAPE_KINDS.indexOf(CATEGORY_SHAPES[category]);
      expect(PIN_SHAPE_OF_VERT).toContain(`if (category == ${i}) return ${index.toFixed(1)};`);
    });
  });

  it('is wired into both pin shaders', () => {
    expect(PIN_FRAG).toContain('float shapeDistance(vec2 p, float shape)');
    expect(PIN_FRAG).toMatch(/varying float vShape;/);
    expect(PIN_VERT).toMatch(/varying float vShape;/);
    expect(PIN_VERT).toContain('vShape = shapeOf(');
  });

  it('keeps the ring clear of every shape and mark', () => {
    const widest = Math.max(...SHAPE_KINDS.map(shapeReach));
    expect(PIN_REACH).toBeCloseTo(CORE_RADIUS * widest, 12);
    expect(ORB_REACH).toBeGreaterThan(ORB_CORE_RADIUS);
    // The grown quad holds the ring.
    expect(ORB_REACH).toBeLessThan(SELECTION_QUAD_SCALE - 0.3);
  });

  it('puts the mark on the rim up and to the right, inside the quad', () => {
    const [x, y] = ORB_MARK_CENTRE;
    expect(x).toBeGreaterThan(0);
    expect(y).toBeCloseTo(x, 12);
    expect(
      Math.hypot(x, y) + ORB_MARK_RADIUS * Math.max(...SHAPE_KINDS.map(shapeReach)),
    ).toBeLessThan(1);
  });

  it('keeps the badge ink dark enough to outline a mark of every hue', () => {
    // The mark's outline is BADGE_INK, near black: 3:1 against each hue (WCAG 1.4.11).
    const luminance = (hex: number): number => {
      const channel = (c: number): number => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * channel((hex >> 16) & 255) +
        0.7152 * channel((hex >> 8) & 255) +
        0.0722 * channel(hex & 255)
      );
    };
    const ink = 0.2126 * BADGE_INK[0] + 0.7152 * BADGE_INK[1] + 0.0722 * BADGE_INK[2];
    for (const hex of Object.values(CATEGORY_HUES)) {
      expect((luminance(hex) + 0.05) / (ink + 0.05)).toBeGreaterThan(3);
    }
  });
});
