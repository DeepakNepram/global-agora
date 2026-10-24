import { describe, expect, it } from 'vitest';

import {
  CATEGORY_SHAPES,
  SHAPE_KINDS,
  shapeDistance,
  shapeOutline,
  shapePath,
  shapeReach,
  type ShapeKind,
} from './categoryShapes';
import { NEWS_CATEGORIES } from './nodeBuffer';

function area(outline: readonly (readonly [number, number])[]): number {
  let sum = 0;
  outline.forEach(([x, y], i) => {
    const [nx, ny] = outline[(i + 1) % outline.length] ?? [0, 0];
    sum += x * ny - nx * y;
  });
  return Math.abs(sum) / 2;
}

/** Even-odd ray cast: the reference the distance's sign must agree with. */
function inside(outline: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let hit = false;
  outline.forEach(([ax, ay], i) => {
    const [bx, by] = outline[(i + 1) % outline.length] ?? [0, 0];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
  });
  return hit;
}

const POLYGONS = SHAPE_KINDS.filter((kind) => kind !== 'circle');

describe('category shapes', () => {
  it('gives every category its own shape', () => {
    const used = NEWS_CATEGORIES.map((category) => CATEGORY_SHAPES[category]);
    expect(new Set(used).size).toBe(NEWS_CATEGORIES.length);
  });

  it.each(POLYGONS)('%s has the area of the unit circle', (kind) => {
    const outline = shapeOutline(kind);
    expect(outline).not.toBeNull();
    expect(area(outline ?? [])).toBeCloseTo(Math.PI, 6);
  });

  it.each(POLYGONS)('%s: the distance is 0 on every vertex', (kind) => {
    for (const [x, y] of shapeOutline(kind) ?? []) {
      expect(Math.abs(shapeDistance(kind, x, y))).toBeLessThan(1e-9);
    }
  });

  it.each(POLYGONS)('%s: the sign of the distance matches the outline', (kind) => {
    const outline = shapeOutline(kind) ?? [];
    for (let i = 0; i < 2000; i++) {
      // A fixed lattice over the shape and a margin around it.
      const x = ((i * 0.6180339887) % 1) * 4 - 2;
      const y = ((i * 0.7548776662) % 1) * 4 - 2;
      const distance = shapeDistance(kind, x, y);
      if (Math.abs(distance) < 1e-6) continue;
      expect(distance < 0).toBe(inside(outline, x, y));
    }
  });

  it('measures true distance outside a straight edge', () => {
    // The square's top edge sits at the half-side, √π / 2.
    const half = Math.sqrt(Math.PI) / 2;
    expect(shapeDistance('square', 0, half + 0.5)).toBeCloseTo(0.5, 9);
    expect(shapeDistance('square', 0, 0)).toBeCloseTo(-half, 9);
    expect(shapeDistance('circle', 0, 3)).toBeCloseTo(2, 9);
  });

  it('points the triangles up and down', () => {
    const [, topY] = shapeOutline('triangle')?.[0] ?? [0, 0];
    const [, bottomY] = shapeOutline('triangleDown')?.[0] ?? [0, 0];
    expect(topY).toBeGreaterThan(0);
    expect(bottomY).toBeLessThan(0);
  });

  it('writes SVG paths with y down', () => {
    expect(shapePath('triangle').startsWith('M0 -')).toBe(true);
    expect(shapePath('circle', 2)).toBe('M2 0A2 2 0 1 1 -2 0A2 2 0 1 1 2 0Z');
    for (const kind of SHAPE_KINDS) expect(shapePath(kind)).toMatch(/^M[-\d.]+ [-\d.]+.*Z$/);
  });

  it.each<[ShapeKind, number]>([
    ['circle', 1],
    ['square', Math.sqrt(Math.PI / 2)],
  ])('%s reaches %f from its centre', (kind, reach) => {
    expect(shapeReach(kind)).toBeCloseTo(reach, 9);
  });
});
