/**
 * The order Tab visits the pins on the globe and the flat map (Prompt 5.1):
 * nearest the centre of the view first, spiralling out, because the centre
 * is where the arrow keys aim. Turn toward a region, then Tab through it.
 */

export interface FocusPoint {
  readonly x: number;
  readonly y: number;
}

/** Closer than this (CSS px) counts as the same distance, and then the angle decides. */
const SAME_DISTANCE_PX = 0.5;

/** Clockwise from straight up, in [0, 2π): the screen's y runs down. */
function bearing(point: FocusPoint, centre: FocusPoint): number {
  const angle = Math.atan2(point.x - centre.x, centre.y - point.y);
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

/** Indexes into `points`, nearest `centre` first; equal distances go clockwise from up. */
export function nearestFirst(points: readonly FocusPoint[], centre: FocusPoint): number[] {
  const distance = points.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y));
  return points
    .map((_, i) => i)
    .sort((a, b) => {
      const by = (distance[a] ?? 0) - (distance[b] ?? 0);
      if (Math.abs(by) >= SAME_DISTANCE_PX) return by;
      return bearing(points[a] ?? centre, centre) - bearing(points[b] ?? centre, centre);
    });
}

/**
 * Where Tab goes from position `current` in a list of `count` pins (−1: the
 * view itself, no pin yet): the next position, −1 back to the view itself
 * (Shift+Tab from the first pin), or null to let focus leave the view, so
 * the pins are never a keyboard trap.
 */
export function stepFocus(count: number, current: number, backward: boolean): number | null {
  if (backward) return current > 0 ? Math.min(current, count) - 1 : current === 0 ? -1 : null;
  const next = current + 1;
  return next < count ? next : null;
}
