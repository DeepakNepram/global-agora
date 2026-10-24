import { describe, expect, it } from 'vitest';

import { afterContextLoss, CONTEXT_LOSS_WINDOW_MS } from './contextLoss';

describe('WebGL context loss', () => {
  it('tries again after a first and a second loss', () => {
    const first = afterContextLoss([], 1000);
    expect(first).toEqual({ lossesMs: [1000], giveUp: false });
    const second = afterContextLoss(first.lossesMs, 61_000);
    expect(second).toEqual({ lossesMs: [1000, 61_000], giveUp: false });
  });

  it('gives up on the third loss inside the window', () => {
    expect(afterContextLoss([1000, 61_000], 121_000).giveUp).toBe(true);
  });

  it('forgets losses older than the window', () => {
    const late = afterContextLoss([1000, 61_000], 1000 + CONTEXT_LOSS_WINDOW_MS + 1);
    expect(late).toEqual({ lossesMs: [61_000, 1000 + CONTEXT_LOSS_WINDOW_MS + 1], giveUp: false });
  });
});
