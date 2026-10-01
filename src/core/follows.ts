/**
 * Follows: places, categories and single stories a reader keeps up with. The
 * same shape on the device and in the database (`follows`, Prompt 3.4), with
 * one spelling per target so the same follow from two devices is one row:
 *
 *   place     city:<Natural Earth ne_id> | country:<ISO-2>   never coordinates
 *   category  a NEWS_CATEGORIES name
 *   story     a payload id
 */

// Explicit .ts: scripts/db/smoke.ts loads this under plain Node, which needs it.
import { isNewsCategory } from './categories.ts';
import type { NewsCategory } from './nodeBuffer';

export type FollowKind = 'place' | 'category' | 'story';

export interface Follow {
  readonly kind: FollowKind;
  readonly target: string;
  /** What the reader saw when following: "Tokyo, Japan", "Climate", a headline. */
  readonly label: string;
  /** A story's source count when followed; null for other kinds. */
  readonly baseline: number | null;
  readonly createdAtMs: number;
}

export type FollowTarget =
  | { readonly type: 'city'; readonly id: number }
  | { readonly type: 'country'; readonly code: string }
  | { readonly type: 'category'; readonly category: NewsCategory }
  | { readonly type: 'story'; readonly id: number };

const CITY_RE = /^city:([1-9]\d{0,15})$/;
const COUNTRY_RE = /^country:([A-Z]{2})$/;
const STORY_RE = /^[1-9]\d{0,15}$/;
/** As follows.label allows. */
export const FOLLOW_LABEL_MAX = 300;

export function cityTarget(id: number): string {
  return `city:${id}`;
}

export function countryTarget(code: string): string {
  return `country:${code}`;
}

export function storyTarget(id: number): string {
  return String(id);
}

/** What a follow points at, or null when its target is malformed for its kind. */
export function followTarget(kind: FollowKind, target: string): FollowTarget | null {
  if (kind === 'place') {
    const city = CITY_RE.exec(target);
    if (city) return { type: 'city', id: Number(city[1]) };
    const country = COUNTRY_RE.exec(target);
    return country ? { type: 'country', code: country[1] ?? '' } : null;
  }
  if (kind === 'category')
    return isNewsCategory(target) ? { type: 'category', category: target } : null;
  return STORY_RE.test(target) ? { type: 'story', id: Number(target) } : null;
}

export function followKey(follow: Pick<Follow, 'kind' | 'target'>): string {
  return `${follow.kind}:${follow.target}`;
}

/** A follow as storage or the database holds it, checked field by field. */
export function isFollow(value: unknown): value is Follow {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const kind = v['kind'];
  const target = v['target'];
  const label = v['label'];
  const baseline = v['baseline'];
  return (
    (kind === 'place' || kind === 'category' || kind === 'story') &&
    typeof target === 'string' &&
    followTarget(kind, target) !== null &&
    typeof label === 'string' &&
    label.length >= 1 &&
    label.length <= FOLLOW_LABEL_MAX &&
    (baseline === null ||
      (typeof baseline === 'number' && Number.isInteger(baseline) && baseline >= 0)) &&
    typeof v['createdAtMs'] === 'number' &&
    Number.isFinite(v['createdAtMs'])
  );
}

/** A label within the column's length, never empty. */
export function followLabel(text: string, fallback: string): string {
  const trimmed = text.trim();
  return (trimmed === '' ? fallback : trimmed).slice(0, FOLLOW_LABEL_MAX);
}
