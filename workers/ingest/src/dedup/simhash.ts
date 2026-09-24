/**
 * 64-bit simhash over a title's character trigrams (Charikar 2002).
 *
 * Each trigram hashes to 64 pseudo-random bits; bit i of the simhash is 1 when
 * more trigrams have bit i set than clear. Similar titles share most trigrams,
 * so their simhashes differ in few bits. At Hamming distance <= 3 this catches
 * copies of one write-up ("… | Chester and District Standard" vs the bare
 * headline); a reworded headline typically lands 15-25 bits away (measured on
 * the 2026-09-24 feed), which is why event grouping also needs keys.ts.
 *
 * Kept as two uint32 halves: JavaScript bit operators are 32-bit, and BigInt
 * is only needed at the database boundary.
 */

export interface Simhash {
  readonly hi: number;
  readonly lo: number;
}

export const NEAR_DUPLICATE_BITS = 3;

/** FNV-1a over three UTF-16 units, 32-bit. */
function fnv1a3(text: string, at: number): number {
  let h = 0x811c9dc5;
  for (let i = at; i < at + 3; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** murmur3's fmix32: a bijection that spreads one 32-bit hash into a second, independent-looking one. */
function fmix32(value: number): number {
  let h = value ^ (value >>> 16);
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Simhash of an already-normalized title (normalizeTitle), padded so edges count. */
export function simhash(normalized: string): Simhash {
  const text = ` ${normalized} `;
  const votes = new Int32Array(64);
  for (let i = 0; i + 3 <= text.length; i++) {
    const lo = fnv1a3(text, i);
    const hi = fmix32(lo ^ 0x9e3779b9);
    for (let bit = 0; bit < 32; bit++) {
      votes[bit] = (votes[bit] ?? 0) + (((lo >>> bit) & 1) === 1 ? 1 : -1);
      votes[32 + bit] = (votes[32 + bit] ?? 0) + (((hi >>> bit) & 1) === 1 ? 1 : -1);
    }
  }
  let lo = 0;
  let hi = 0;
  for (let bit = 0; bit < 32; bit++) {
    if ((votes[bit] ?? 0) > 0) lo |= 1 << bit;
    if ((votes[32 + bit] ?? 0) > 0) hi |= 1 << bit;
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

function popcount32(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

export function hamming(a: Simhash, b: Simhash): number {
  return popcount32((a.hi ^ b.hi) >>> 0) + popcount32((a.lo ^ b.lo) >>> 0);
}

export function isNearDuplicate(a: Simhash, b: Simhash): boolean {
  return hamming(a, b) <= NEAR_DUPLICATE_BITS;
}

/**
 * The four 16-bit bands. Two hashes within 3 bits share at least one band
 * exactly (3 differing bits touch at most 3 of 4 bands), so bucketing by band
 * finds every near-duplicate without comparing all pairs.
 */
export function bands(hash: Simhash): [number, number, number, number] {
  return [hash.hi >>> 16, hash.hi & 0xffff, hash.lo >>> 16, hash.lo & 0xffff];
}

export function toHex(hash: Simhash): string {
  return hash.hi.toString(16).padStart(8, '0') + hash.lo.toString(16).padStart(8, '0');
}

export function fromHex(hex: string): Simhash | null {
  if (!/^[0-9a-f]{16}$/.test(hex)) return null;
  return { hi: parseInt(hex.slice(0, 8), 16) >>> 0, lo: parseInt(hex.slice(8), 16) >>> 0 };
}

/** The signed 64-bit integer Postgres stores in `stories.title_hash`, as a decimal string. */
export function toBigintString(hash: Simhash): string {
  return BigInt.asIntN(64, (BigInt(hash.hi) << 32n) | BigInt(hash.lo)).toString();
}
