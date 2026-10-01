/**
 * Share links: a URL that reopens exactly the view it was copied from, with
 * the camera, the displayed instant and the open story.
 *
 *   /?story=23904&cam=51.5074,-0.1278,1200&t=20261001T123456Z
 *
 * - `story`: the payload id (stories.seq), as GET /api/story/:id takes it.
 * - `cam`: latitude, longitude and altitude in km. Four decimals of a degree
 *   are ~11 m, finer than a pixel even at the closest zoom (50 km); altitude
 *   keeps one decimal below FINE_ALTITUDE_KM, where a whole km is 1 % or more.
 * - `t`: the instant in basic ISO 8601 UTC, to the second. Readable, and made
 *   of characters a query never escapes, so the link stays legible when pasted.
 *
 * Every field decodes on its own: a mangled camera still opens the story at
 * its time. Plain functions, no DOM, so a native shell can share the format.
 */

import { normalizeLon, type LatLon } from './geo';

/** The camera as a link carries it; the same shape as the globe's CameraPose. */
export interface CameraView extends LatLon {
  /** Height above the surface, km. */
  readonly altitudeKm: number;
}

export interface Permalink {
  /** Payload id of the open story. */
  readonly story: number | null;
  readonly camera: CameraView | null;
  /** The displayed instant, epoch ms, whole seconds. */
  readonly timeMs: number | null;
}

export const PERMALINK_PARAMS = { story: 'story', camera: 'cam', time: 't' } as const;

const COORD_DECIMALS = 4;
const FINE_ALTITUDE_KM = 100;
/** Story ids are stored as Uint32 (NodeBuffer.ids). */
const MAX_STORY_ID = 0xffffffff;
/** Anything farther is not a view of the globe; the controls clamp the rest. */
const MAX_ALTITUDE_KM = 1_000_000;

const STORY_RE = /^[1-9]\d{0,9}$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
const TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

/** Fixed decimals without trailing zeros or a negative zero: 51.5, not 51.5000 or -0. */
function trimmed(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals));
  return String(rounded === 0 ? 0 : rounded);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Basic ISO 8601 UTC to the second: 20261001T123456Z. */
export function formatLinkTime(timeMs: number): string {
  const d = new Date(Math.round(timeMs / 1000) * 1000);
  return (
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function parseLinkTime(raw: string): number | null {
  const match = TIME_RE.exec(raw);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  // Date.UTC rolls 30 February into March; a round trip catches it.
  const d = new Date(ms);
  const exact =
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day &&
    d.getUTCHours() === hour &&
    d.getUTCMinutes() === minute &&
    d.getUTCSeconds() === second;
  return exact ? ms : null;
}

function encodeCamera(camera: CameraView): string {
  const lat = Math.min(Math.max(camera.lat, -90), 90);
  const altitude = trimmed(camera.altitudeKm, camera.altitudeKm < FINE_ALTITUDE_KM ? 1 : 0);
  return `${trimmed(lat, COORD_DECIMALS)},${trimmed(normalizeLon(camera.lon), COORD_DECIMALS)},${altitude}`;
}

function decodeCamera(raw: string): CameraView | null {
  const parts = raw.split(',');
  if (parts.length !== 3 || !parts.every((part) => NUMBER_RE.test(part))) return null;
  const [lat, lon, altitudeKm] = parts.map(Number) as [number, number, number];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (!(altitudeKm > 0 && altitudeKm < MAX_ALTITUDE_KM)) return null;
  return { lat, lon, altitudeKm };
}

function decodeStory(raw: string): number | null {
  if (!STORY_RE.test(raw)) return null;
  const id = Number(raw);
  return id <= MAX_STORY_ID ? id : null;
}

/**
 * The link for `link` on the app at `baseUrl` (its origin and path; any query
 * or fragment there is replaced). Null fields are left out.
 */
export function encodePermalink(baseUrl: string, link: Permalink): string {
  const url = new URL(baseUrl);
  const parts: string[] = [];
  if (link.story !== null) parts.push(`${PERMALINK_PARAMS.story}=${link.story}`);
  if (link.camera !== null) parts.push(`${PERMALINK_PARAMS.camera}=${encodeCamera(link.camera)}`);
  if (link.timeMs !== null && Number.isFinite(link.timeMs)) {
    parts.push(`${PERMALINK_PARAMS.time}=${formatLinkTime(link.timeMs)}`);
  }
  const base = `${url.origin}${url.pathname}`;
  return parts.length > 0 ? `${base}?${parts.join('&')}` : base;
}

/** Reads a query string (with or without its "?"). Fields that do not validate come back null. */
export function decodePermalink(search: string): Permalink {
  const params = new URLSearchParams(search);
  const story = params.get(PERMALINK_PARAMS.story);
  const camera = params.get(PERMALINK_PARAMS.camera);
  const time = params.get(PERMALINK_PARAMS.time);
  return {
    story: story === null ? null : decodeStory(story),
    camera: camera === null ? null : decodeCamera(camera),
    timeMs: time === null ? null : parseLinkTime(time),
  };
}

export function isEmptyPermalink(link: Permalink): boolean {
  return link.story === null && link.camera === null && link.timeMs === null;
}

/**
 * The query string without the permalink's fields, others kept ("" when none
 * are left): once the view has been applied, the address bar should not keep
 * claiming it.
 */
export function withoutPermalink(search: string): string {
  const params = new URLSearchParams(search);
  for (const name of Object.values(PERMALINK_PARAMS)) params.delete(name);
  const rest = params.toString();
  return rest === '' ? '' : `?${rest}`;
}
