import { describe, expect, it } from 'vitest';

import { nearestFirst, stepFocus } from './pinFocusOrder';

describe('nearestFirst', () => {
  it('starts nearest the centre and works outward', () => {
    const centre = { x: 100, y: 100 };
    const points = [
      { x: 100, y: 10 },
      { x: 105, y: 100 },
      { x: 160, y: 100 },
      { x: 100, y: 130 },
    ];
    expect(nearestFirst(points, centre)).toEqual([1, 3, 2, 0]);
  });

  it('goes clockwise from up between equal distances', () => {
    const centre = { x: 0, y: 0 };
    const points = [
      { x: -10, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: -10 },
    ];
    // Up is −y on screen, then right, down, left.
    expect(nearestFirst(points, centre)).toEqual([3, 2, 1, 0]);
  });

  it('handles nothing to visit', () => {
    expect(nearestFirst([], { x: 0, y: 0 })).toEqual([]);
  });
});

describe('stepFocus', () => {
  it('walks forward from the view itself, then lets focus leave', () => {
    expect(stepFocus(3, -1, false)).toBe(0);
    expect(stepFocus(3, 1, false)).toBe(2);
    expect(stepFocus(3, 2, false)).toBeNull();
    expect(stepFocus(0, -1, false)).toBeNull();
  });

  it('walks back to the view itself, then lets focus leave backward', () => {
    expect(stepFocus(3, 2, true)).toBe(1);
    expect(stepFocus(3, 0, true)).toBe(-1);
    expect(stepFocus(3, -1, true)).toBeNull();
  });

  it('steps back from past a list that shrank', () => {
    expect(stepFocus(2, 5, true)).toBe(1);
  });
});
