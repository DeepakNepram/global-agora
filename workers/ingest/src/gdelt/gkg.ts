/**
 * GKG 2.1 rows, parsed from the real feed rather than from the codebook alone.
 *
 * Verified against data.gdeltproject.org/gdeltv2/20260924084500.gkg.csv.zip
 * (993 rows, every one with 27 tab-separated columns). Only the columns the
 * pipeline uses are read; the rest (GCAM alone is ~13 KB a row) are skipped
 * without being split further. The fixture in test/fixtures is real rows.
 */

import { parseGdeltTime } from './slots.ts';

export const GKG_COLUMNS = 27;

/** Column indexes (GKG 2.1 codebook, confirmed on the live file). */
export const COL = {
  recordId: 0,
  date: 1, // when GDELT saw the article, YYYYMMDDHHMMSS
  domain: 3, // V2SOURCECOMMONNAME
  url: 4, // V2DOCUMENTIDENTIFIER
  themes: 7, // V1THEMES: THEME;THEME
  themesV2: 8, // V2ENHANCEDTHEMES: THEME,offset;THEME,offset
  locationsV2: 10, // type#name#fips#adm1#adm2#lat#lon#featureId#offset;…
  persons: 11, // V1PERSONS, lowercase, de-duplicated
  orgs: 13, // V1ORGANIZATIONS, lowercase, de-duplicated
  tone: 15, // tone,positive,negative,polarity,…
  image: 18, // V2.1SHARINGIMAGE
  translation: 25, // empty on the English feed
  extras: 26, // <PAGE_TITLE>…</PAGE_TITLE><PAGE_PRECISEPUBTIMESTAMP>…
} as const;

/** GKG location types. Countries are centroids, so they place a pin badly. */
export const LocationType = {
  country: 1,
  usState: 2,
  usCity: 3,
  worldCity: 4,
  worldState: 5,
} as const;

export interface GkgLocation {
  readonly type: number;
  readonly name: string;
  /** FIPS 10-4, not ISO: `UK` is Britain, `AS` Australia (see geo/fips.ts). */
  readonly fips: string;
  readonly lat: number;
  readonly lon: number;
  readonly featureId: string;
  /** Character offset of this mention in the article text. */
  readonly offset: number;
}

export interface GkgRecord {
  readonly recordId: string;
  readonly seenAt: number;
  readonly domain: string;
  readonly url: string;
  /** Theme -> number of mentions. */
  readonly themes: ReadonlyMap<string, number>;
  readonly locations: readonly GkgLocation[];
  readonly persons: readonly string[];
  readonly orgs: readonly string[];
  readonly tone: number | null;
  readonly imageUrl: string | null;
  /** As published: HTML entities still encoded (normalize/title.ts decodes). */
  readonly title: string | null;
  /** The page's own publish time, when GDELT found one (about half of rows). */
  readonly publishedAt: number | null;
  readonly translated: boolean;
}

export interface GkgParse {
  readonly records: GkgRecord[];
  /** Rows without 27 columns or without a date, URL or domain. */
  readonly malformed: number;
}

function list(value: string | undefined): string[] {
  return value === undefined || value === '' ? [] : value.split(';').filter((item) => item !== '');
}

function parseThemes(v2: string | undefined, v1: string | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  const entries = list(v2);
  if (entries.length > 0) {
    for (const entry of entries) {
      const comma = entry.indexOf(',');
      const theme = comma < 0 ? entry : entry.slice(0, comma);
      if (theme !== '') counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
    return counts;
  }
  for (const theme of list(v1)) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  return counts;
}

function parseLocations(value: string | undefined): GkgLocation[] {
  const locations: GkgLocation[] = [];
  for (const entry of list(value)) {
    const f = entry.split('#');
    if (f.length !== 9) continue;
    const type = Number(f[0]);
    const lat = Number(f[5]);
    const lon = Number(f[6]);
    // An empty coordinate is a gap, not (0, 0): Number('') would say 0.
    if (f[5] === '' || f[6] === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || !(type >= 1 && type <= 5)) continue;
    locations.push({
      type,
      name: f[1] ?? '',
      fips: f[2] ?? '',
      lat,
      lon,
      featureId: f[7] ?? '',
      offset: Number(f[8]) || 0,
    });
  }
  return locations;
}

/** The text between `<tag>` and `</tag>`, found with indexOf: this runs per row. */
export function extraTag(extras: string, tag: string): string | null {
  const open = `<${tag}>`;
  const start = extras.indexOf(open);
  if (start < 0) return null;
  const end = extras.indexOf(`</${tag}>`, start + open.length);
  return end < 0 ? null : extras.slice(start + open.length, end);
}

function parseRow(line: string): GkgRecord | null {
  const f = line.split('\t');
  if (f.length !== GKG_COLUMNS) return null;

  const seenAt = parseGdeltTime(f[COL.date] ?? '');
  const url = f[COL.url] ?? '';
  const domain = (f[COL.domain] ?? '').toLowerCase();
  if (seenAt === null || url === '' || domain === '') return null;

  const extras = f[COL.extras] ?? '';
  const precise = extraTag(extras, 'PAGE_PRECISEPUBTIMESTAMP');
  const tone = Number.parseFloat(f[COL.tone] ?? '');
  const image = f[COL.image] ?? '';

  return {
    recordId: f[COL.recordId] ?? '',
    seenAt,
    domain,
    url,
    themes: parseThemes(f[COL.themesV2], f[COL.themes]),
    locations: parseLocations(f[COL.locationsV2]),
    persons: list(f[COL.persons]),
    orgs: list(f[COL.orgs]),
    tone: Number.isFinite(tone) ? tone : null,
    imageUrl: image === '' ? null : image,
    title: extraTag(extras, 'PAGE_TITLE'),
    publishedAt: precise === null ? null : parseGdeltTime(precise),
    translated: (f[COL.translation] ?? '') !== '',
  };
}

/** Every well-formed row of a GKG file. */
export function parseGkg(text: string): GkgParse {
  const records: GkgRecord[] = [];
  let malformed = 0;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '') continue;
    const record = parseRow(line);
    if (record === null) malformed++;
    else records.push(record);
  }
  return { records, malformed };
}
