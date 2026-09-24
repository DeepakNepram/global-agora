/**
 * Render slots keyed by story id, never by row. A payload refresh reorders
 * rows, adds stories and drops others; keyed slots mean a story that stays
 * keeps its slot (so its pin, pulse and animation carry on), a new story takes
 * a free slot, and a slot whose story left is not reused until its fade-out
 * has finished, so no slot ever shows two stories at once.
 */

export interface SlotAssignment {
  /** Slot per row of the payload. */
  readonly rowSlots: Int32Array;
  /** Slots whose stories this payload no longer has. They stay reserved until release(). */
  readonly departed: readonly number[];
  /** 1 for a slot whose story was not here before. Indexed by slot. */
  readonly fresh: Uint8Array;
}

export interface SlotMap {
  assign(ids: Uint32Array, count: number): SlotAssignment;
  /** Returns departed slots to the free list once nothing draws them. */
  release(slots: readonly number[]): void;
  /** One past the highest slot ever handed out: the instance count to draw. */
  readonly highWater: number;
  slotOf(id: number): number | undefined;
  /** Forgets everything (a different source of stories). */
  reset(): void;
}

export function createSlotMap(): SlotMap {
  let byId = new Map<number, number>();
  /** Sorted high to low, so pop() hands out the lowest: the drawn range stays compact. */
  let free: number[] = [];
  let highWater = 0;

  const take = (): number => free.pop() ?? highWater++;

  return {
    get highWater() {
      return highWater;
    },

    assign(ids, count) {
      const rowSlots = new Int32Array(count);
      const next = new Map<number, number>();
      const newRows: number[] = [];
      for (let row = 0; row < count; row++) {
        const id = ids[row] ?? 0;
        const slot = byId.get(id);
        if (slot !== undefined && !next.has(id)) {
          next.set(id, slot);
          rowSlots[row] = slot;
        } else {
          newRows.push(row);
        }
      }
      const departed: number[] = [];
      for (const [id, slot] of byId) if (!next.has(id)) departed.push(slot);

      // Departed slots are still reserved, so new stories never land on a slot
      // that is fading out.
      for (const row of newRows) {
        const slot = take();
        rowSlots[row] = slot;
        next.set(ids[row] ?? 0, slot);
      }
      const fresh = new Uint8Array(highWater);
      for (const row of newRows) fresh[rowSlots[row] ?? 0] = 1;
      byId = next;
      return { rowSlots, departed, fresh };
    },

    release(slots) {
      const inUse = new Set(byId.values());
      const pool = new Set(free);
      for (const slot of slots) if (!inUse.has(slot) && slot < highWater) pool.add(slot);
      free = [...pool].sort((a, b) => b - a);
    },

    slotOf: (id) => byId.get(id),

    reset() {
      byId = new Map();
      free = [];
      highWater = 0;
    },
  };
}
