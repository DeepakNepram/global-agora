import { describe, expect, it } from 'vitest';

import { createSlotMap } from './pinSlots';

const ids = (...values: number[]): Uint32Array => Uint32Array.from(values);

describe('createSlotMap', () => {
  it('keeps each story in its slot however the rows are reordered', () => {
    const slots = createSlotMap();
    const first = slots.assign(ids(10, 20, 30), 3);
    expect(Array.from(first.rowSlots)).toEqual([0, 1, 2]);
    expect(Array.from(first.fresh)).toEqual([1, 1, 1]);

    const reordered = slots.assign(ids(30, 10, 20), 3);
    expect(Array.from(reordered.rowSlots)).toEqual([2, 0, 1]);
    expect(Array.from(reordered.fresh)).toEqual([0, 0, 0]);
    expect(reordered.departed).toEqual([]);
  });

  it("holds a departed story's slot until it is released, then reuses the lowest", () => {
    const slots = createSlotMap();
    slots.assign(ids(1, 2, 3, 4), 4);
    const next = slots.assign(ids(1, 4, 5), 3);
    expect([...next.departed].sort()).toEqual([1, 2]);
    // Slots 1 and 2 are still fading out, so the new story takes a new slot.
    expect(next.rowSlots[2]).toBe(4);
    expect(next.fresh[4]).toBe(1);

    slots.release(next.departed);
    const later = slots.assign(ids(1, 4, 5, 6, 7), 5);
    expect(Array.from(later.rowSlots)).toEqual([0, 3, 4, 1, 2]);
    expect(slots.highWater).toBe(5);
  });

  it('never releases a slot a story still holds', () => {
    const slots = createSlotMap();
    slots.assign(ids(1, 2), 2);
    slots.release([0]);
    const next = slots.assign(ids(1, 2, 3), 3);
    expect(Array.from(next.rowSlots)).toEqual([0, 1, 2]);
  });

  it('gives a duplicated id its own slot rather than drawing two rows in one', () => {
    const slots = createSlotMap();
    const assigned = slots.assign(ids(8, 8), 2);
    expect(new Set(assigned.rowSlots).size).toBe(2);
  });

  it('forgets everything on reset', () => {
    const slots = createSlotMap();
    slots.assign(ids(1, 2, 3), 3);
    slots.reset();
    expect(slots.highWater).toBe(0);
    expect(slots.slotOf(1)).toBeUndefined();
    expect(Array.from(slots.assign(ids(3), 1).fresh)).toEqual([1]);
  });
});
