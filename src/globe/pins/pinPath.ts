import { springAt, type SpringState } from './bloom';
import { PIN_OFFSET, PIN_STRIDE, hiddenLook, isVisibleLook } from './pinInstances';

/**
 * CPU mirror of the vertex shader's path: where a slot is drawn at a given
 * clock. The planner starts new paths from here, so a pin redirected mid-flight
 * continues from where it is on screen instead of jumping.
 */

/** One end of a slot's path, or a point along it. */
export interface PinEnd {
  x: number;
  y: number;
  z: number;
  look: number;
  /** Screen offset, CSS px, y up. */
  ox: number;
  oy: number;
}

export interface DrawnState extends PinEnd {
  /** Path progress and its rate, from the spring. */
  u: number;
  v: number;
  alpha: number;
}

export type Side = 'inner' | 'outer';

export function createEnd(): PinEnd {
  return { x: 0, y: 0, z: 0, look: 0, ox: 0, oy: 0 };
}

export function readEnd(array: Float32Array, slot: number, side: Side, out: PinEnd): PinEnd {
  const at = slot * PIN_STRIDE;
  const base = at + (side === 'inner' ? PIN_OFFSET.inner : PIN_OFFSET.outer);
  const px = at + (side === 'inner' ? PIN_OFFSET.innerPx : PIN_OFFSET.outerPx);
  out.x = array[base] ?? 0;
  out.y = array[base + 1] ?? 0;
  out.z = array[base + 2] ?? 0;
  out.look = array[base + 3] ?? 0;
  out.ox = array[px] ?? 0;
  out.oy = array[px + 1] ?? 0;
  return out;
}

export function writeEnd(array: Float32Array, slot: number, side: Side, end: PinEnd): void {
  const at = slot * PIN_STRIDE;
  const base = at + (side === 'inner' ? PIN_OFFSET.inner : PIN_OFFSET.outer);
  const px = at + (side === 'inner' ? PIN_OFFSET.innerPx : PIN_OFFSET.outerPx);
  array[base] = end.x;
  array[base + 1] = end.y;
  array[base + 2] = end.z;
  array[base + 3] = end.look;
  array[px] = end.ox;
  array[px + 1] = end.oy;
}

/** Equal as stored: anchors and offsets survive a float32 round trip only approximately. */
export function sameEnd(a: PinEnd, b: PinEnd): boolean {
  return a.look === b.look && samePlace(a, b);
}

/** The same anchor and offset, whatever each draws there. */
export function samePlace(a: PinEnd, b: PinEnd): boolean {
  return (
    Math.abs(a.x - b.x) < 1e-5 &&
    Math.abs(a.y - b.y) < 1e-5 &&
    Math.abs(a.z - b.z) < 1e-5 &&
    Math.abs(a.ox - b.ox) < 1e-3 &&
    Math.abs(a.oy - b.oy) < 1e-3
  );
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Opacity along a path, mirrored in the shader. The visible end dominates most
 * of the way, so a child is fully there within the first 30 % of its way out
 * of an orb and fades only in the last 30 % of its way back in:
 *   w = aOuter ≥ aInner ? smoothstep(0, 0.3, u) : smoothstep(0.7, 1, u)
 *   alpha = mix(aInner, aOuter, w)
 */
export function pathAlpha(innerLook: number, outerLook: number, u: number): number {
  const a = isVisibleLook(innerLook) ? 1 : 0;
  const b = isVisibleLook(outerLook) ? 1 : 0;
  const w = b >= a ? smoothstep(0, 0.3, u) : smoothstep(0.7, 1, u);
  return a + (b - a) * w;
}

const scratchInner = createEnd();
const scratchOuter = createEnd();
const scratchSpring: SpringState = { u: 0, v: 0 };

export function createDrawn(): DrawnState {
  return { ...createEnd(), u: 0, v: 0, alpha: 0 };
}

function lookOf(state: DrawnState, heading: number, other: number): number {
  const visibleLook = isVisibleLook(heading) ? heading : other;
  return state.alpha >= 0.5 ? visibleLook : hiddenLook(visibleLook);
}

/**
 * Where `slot` is drawn at `clock`:
 *   ψ = (1 − u) · twist
 *   P = rotate(normalize(mix(inner, outer, u)), about inner, by ψ)      (Rodrigues)
 *   offset = innerPx + rot2(ψ) · u · (outerPx − innerPx)
 * The look is the visible end's while the slot is mostly drawn, else hidden.
 */
export function drawnState(
  array: Float32Array,
  slot: number,
  clock: number,
  out: DrawnState,
): DrawnState {
  const at = slot * PIN_STRIDE;
  const inner = readEnd(array, slot, 'inner', scratchInner);
  const outer = readEnd(array, slot, 'outer', scratchOuter);
  const heading = (array[at + PIN_OFFSET.target] ?? 0) >= 0.5 ? outer : inner;
  const other = heading === outer ? inner : outer;

  const spring = springAt(
    array[at + PIN_OFFSET.u0] ?? 0,
    array[at + PIN_OFFSET.v0] ?? 0,
    array[at + PIN_OFFSET.t0] ?? 0,
    array[at + PIN_OFFSET.target] ?? 0,
    clock,
    scratchSpring,
  );
  const { u } = spring;
  const psi = (1 - u) * (array[at + PIN_OFFSET.twist] ?? 0);

  let px = inner.x + (outer.x - inner.x) * u;
  let py = inner.y + (outer.y - inner.y) * u;
  let pz = inner.z + (outer.z - inner.z) * u;
  const length = Math.hypot(px, py, pz) || 1;
  px /= length;
  py /= length;
  pz /= length;

  // Rodrigues: v' = v cosψ + (k × v) sinψ + k (k · v)(1 − cosψ), k the inner axis.
  const kLength = Math.hypot(inner.x, inner.y, inner.z) || 1;
  const kx = inner.x / kLength;
  const ky = inner.y / kLength;
  const kz = inner.z / kLength;
  const cos = Math.cos(psi);
  const sin = Math.sin(psi);
  const dot = kx * px + ky * py + kz * pz;
  out.x = px * cos + (ky * pz - kz * py) * sin + kx * dot * (1 - cos);
  out.y = py * cos + (kz * px - kx * pz) * sin + ky * dot * (1 - cos);
  out.z = pz * cos + (kx * py - ky * px) * sin + kz * dot * (1 - cos);

  const wayX = (outer.ox - inner.ox) * u;
  const wayY = (outer.oy - inner.oy) * u;
  out.ox = inner.ox + wayX * cos - wayY * sin;
  out.oy = inner.oy + wayX * sin + wayY * cos;

  out.u = u;
  out.v = spring.v;
  out.alpha = pathAlpha(inner.look, outer.look, u);
  out.look = lookOf(out, heading.look, other.look);
  return out;
}
