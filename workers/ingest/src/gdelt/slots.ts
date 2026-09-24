/**
 * GDELT publishes one GKG file per 15-minute slot, named by the slot's UTC
 * timestamp: `20260924084500.gkg.csv.zip`. A slot is that 14-digit string.
 */

export const SLOT_SECONDS = 15 * 60;

/** Epoch seconds for a GDELT `YYYYMMDDHHMMSS` timestamp, or null if it is not one. */
export function parseGdeltTime(value: string): number | null {
  if (!/^\d{14}$/.test(value)) return null;
  const v = value;
  const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(8, 10)}:${v.slice(10, 12)}:${v.slice(12, 14)}Z`;
  const ms = Date.parse(iso);
  // An impossible date (Feb 31) either fails to parse or rolls over; only a
  // real timestamp formats back to itself.
  return Number.isFinite(ms) && formatGdeltTime(ms / 1000) === value ? ms / 1000 : null;
}

/** `YYYYMMDDHHMMSS` for epoch seconds. */
export function formatGdeltTime(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** True for a timestamp on a 15-minute boundary, which is what slots are. */
export function isSlot(value: string): boolean {
  const sec = parseGdeltTime(value);
  return sec !== null && sec % SLOT_SECONDS === 0;
}

/** The slot containing an instant (rounded down to the quarter hour). */
export function slotAt(epochSec: number): string {
  return formatGdeltTime(Math.floor(epochSec / SLOT_SECONDS) * SLOT_SECONDS);
}

export function slotSeconds(slot: string): number {
  const sec = parseGdeltTime(slot);
  if (sec === null || sec % SLOT_SECONDS !== 0) throw new Error(`not a GDELT slot: ${slot}`);
  return sec;
}

export function nextSlot(slot: string): string {
  return formatGdeltTime(slotSeconds(slot) + SLOT_SECONDS);
}

export function previousSlot(slot: string): string {
  return formatGdeltTime(slotSeconds(slot) - SLOT_SECONDS);
}

/** ISO 8601 for the database, which stores the slot as timestamptz. */
export function slotIso(slot: string): string {
  return new Date(slotSeconds(slot) * 1000).toISOString();
}

/** The inverse of slotIso, for slots read back from the database. */
export function slotFromIso(iso: string): string {
  return slotAt(Date.parse(iso) / 1000);
}
