import { describe, expect, it } from 'vitest';

import { TAP_MAX_MS, TAP_SLOP_CSS_PX, createTapTracker } from './tapGesture';

describe('tap tracker', () => {
  it('counts a quick press in place as a tap', () => {
    const taps = createTapTracker();
    taps.down(1, 100, 100, 0, false);
    taps.move(1, 102, 101);
    expect(taps.up(1, 103, 102, 120)).toBe(true);
  });

  it('does not count a drag, even one that comes back', () => {
    const taps = createTapTracker();
    taps.down(1, 100, 100, 0, false);
    taps.move(1, 100 + TAP_SLOP_CSS_PX + 1, 100);
    taps.move(1, 100, 100);
    expect(taps.up(1, 100, 100, 100)).toBe(false);
    taps.down(2, 100, 100, 0, false);
    expect(taps.up(2, 100, 100 + TAP_SLOP_CSS_PX + 1, 100)).toBe(false);
  });

  it('does not count a hold, or a press that stopped a moving globe', () => {
    const taps = createTapTracker();
    taps.down(1, 0, 0, 0, false);
    expect(taps.up(1, 0, 0, TAP_MAX_MS + 1)).toBe(false);
    taps.down(2, 0, 0, 0, true);
    expect(taps.up(2, 0, 0, 50)).toBe(false);
  });

  it('does not count either finger of a pinch, until both have lifted', () => {
    const taps = createTapTracker();
    taps.down(1, 0, 0, 0, false);
    taps.down(2, 50, 0, 10, false);
    expect(taps.up(2, 50, 0, 60)).toBe(false);
    expect(taps.up(1, 0, 0, 70)).toBe(false);
    taps.down(3, 0, 0, 100, false);
    expect(taps.up(3, 0, 0, 150)).toBe(true);
  });

  it('forgets a cancelled press and ignores unknown pointers', () => {
    const taps = createTapTracker();
    taps.down(1, 0, 0, 0, false);
    taps.cancel(1);
    expect(taps.up(1, 0, 0, 10)).toBe(false);
    expect(taps.up(9, 0, 0, 10)).toBe(false);
  });
});
