/**
 * Builds public/data/places.v1.json, the gazetteer behind place search, place
 * follows and the onboarding's home city (Prompt 3.4), from Natural Earth
 * (public domain):
 *
 *   ne_10m_populated_places_simple   7,342 cities: name, country, point, population
 *   ne_50m_admin_0_countries         countries: names, label point, extent
 *
 *   npm run places:build             downloads once into the OS temp directory
 *
 * The output is columnar JSON, like the news payload: one array per field.
 * Column by column, Brotli packs it into about 81 KB; the same records as
 * lines of text took 113 KB. src/core/places.ts validates and reads it.
 *
 * - `code` is ISO 3166-1 alpha-2 (ISO_A2_EH: Natural Earth writes -99 in
 *   ISO_A2 for France and Norway). A city's `country` is that code, or "~"
 *   and a name for the few with none (Somaliland, Northern Cyprus).
 * - City ids are Natural Earth's ne_id, stable across releases, so a followed
 *   city (`city:<id>`) survives a rebuild. Cities are in id order and the
 *   column holds the differences, which are shorter.
 * - `ascii` is empty when it equals `name`. Aliases are comma separated.
 * - Coordinates are hundredths of a degree (~1 km); populations keep two
 *   significant figures, which only rank results and compress far better.
 * - `radius`: how far the country reaches from its label point, in tenths of
 *   a degree. Its parts are taken nearest first until 80 % of its area is in,
 *   so Alaska does not stretch the United States, nor French Guiana France.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_FILE = join(repoRoot, 'public', 'data', 'places.v1.json');
const CACHE_DIR = join(tmpdir(), 'global-agora-places');
const SOURCE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const CITIES = 'ne_10m_populated_places_simple';
const COUNTRIES = 'ne_50m_admin_0_countries';
/** A country reaches as far as the parts holding this share of its area. */
const RADIUS_AREA_SHARE = 0.8;
const MAX_RADIUS_DEG = 35;
const MIN_RADIUS_DEG = 0.5;
/** Territories folded into another country at this scale: a name and a small reach. */
const TERRITORY_RADIUS_DEG = 2;
/**
 * Their names, by ISO code: Natural Earth's cities name only the country
 * ("France" for Cayenne), which would make a second "France" in search.
 */
const TERRITORY_NAMES: Readonly<Record<string, string>> = {
  GF: 'French Guiana',
  GI: 'Gibraltar',
  GP: 'Guadeloupe',
  MQ: 'Martinique',
  RE: 'Réunion',
  SJ: 'Svalbard and Jan Mayen',
  YT: 'Mayotte',
};

type Position = [number, number];
interface Feature {
  readonly properties: Record<string, unknown>;
  readonly geometry: { readonly type: string; readonly coordinates: unknown } | null;
}

async function source(name: string): Promise<Feature[]> {
  const path = join(CACHE_DIR, `${name}.geojson`);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    const url = `${SOURCE_BASE}/${name}.geojson`;
    console.log(`  downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    text = await response.text();
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path, text, 'utf8');
  }
  return (JSON.parse(text) as { features: Feature[] }).features;
}

function str(props: Record<string, unknown>, key: string): string {
  const value = props[key];
  return typeof value === 'string' ? value.trim() : '';
}

function num(props: Record<string, unknown>, key: string): number {
  const value = props[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Hundredths of a degree. */
function centi(value: number): number {
  return Math.round(value * 100) || 0;
}

function twoFigures(value: number): number {
  if (value <= 0) return 0;
  const scale = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);
  return Math.round(value / scale) * scale;
}

/** Great-circle angle between two points, degrees. */
function angleDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / rad;
}

/** Each part's outline (its outer ring). */
function outlines(geometry: Feature['geometry']): Position[][] {
  if (!geometry) return [];
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as Position[][]]
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as Position[][][])
        : [];
  return polygons.map((rings) => rings[0] ?? []);
}

/** A ring's area in square degrees scaled by cos(latitude): enough to weigh parts. */
function ringArea(ring: readonly Position[]): number {
  let sum = 0;
  let lat = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i] ?? [0, 0];
    const [x2, y2] = ring[(i + 1) % ring.length] ?? [0, 0];
    sum += x1 * y2 - x2 * y1;
    lat += y1;
  }
  return (Math.abs(sum) / 2) * Math.cos(((lat / Math.max(1, ring.length)) * Math.PI) / 180);
}

function reachDeg(lat: number, lon: number, geometry: Feature['geometry']): number {
  const parts = outlines(geometry)
    .map((ring) => ({
      area: ringArea(ring),
      reach: Math.max(0, ...ring.map(([x, y]) => angleDeg(lat, lon, y, x))),
    }))
    .sort((a, b) => a.reach - b.reach);
  const total = parts.reduce((sum, part) => sum + part.area, 0);
  let covered = 0;
  let reach = MIN_RADIUS_DEG;
  for (const part of parts) {
    covered += part.area;
    reach = part.reach;
    if (covered >= RADIUS_AREA_SHARE * total) break;
  }
  return Math.min(MAX_RADIUS_DEG, Math.max(MIN_RADIUS_DEG, reach));
}

interface CountryRow {
  code: string;
  name: string;
  aliases: string[];
  lat: number;
  lon: number;
  radius: number;
  population: number;
}

function countryRows(features: readonly Feature[]): Map<string, CountryRow> {
  const rows = new Map<string, CountryRow>();
  for (const { properties: p, geometry } of features) {
    const code = str(p, 'ISO_A2_EH');
    if (!/^[A-Z]{2}$/.test(code)) continue;
    const population = num(p, 'POP_EST');
    const existing = rows.get(code);
    // Australia appears twice (with its Indian Ocean territories): keep the larger.
    if (existing && existing.population >= population) continue;
    const name = str(p, 'NAME_EN') || str(p, 'NAME');
    // Only all-capital abbreviations (USA, UK, UAE): "Afg." and "And." would
    // match the words "afghan" and "and".
    const abbreviation = str(p, 'ABBREV').replaceAll('.', '');
    const aliases = [
      str(p, 'NAME'),
      str(p, 'NAME_LONG'),
      str(p, 'NAME_ALT'),
      str(p, 'ADMIN'),
      /^[A-Z]{2,4}$/.test(abbreviation) ? abbreviation : '',
    ]
      .filter((alias) => alias !== '' && alias !== name && !alias.includes('.'))
      .filter((alias, i, all) => all.indexOf(alias) === i);
    const lat = num(p, 'LABEL_Y');
    const lon = num(p, 'LABEL_X');
    rows.set(code, {
      code,
      name,
      aliases,
      lat,
      lon,
      radius: reachDeg(lat, lon, geometry),
      population,
    });
  }
  return rows;
}

async function main(): Promise<void> {
  const [cityFeatures, countryFeatures] = await Promise.all([source(CITIES), source(COUNTRIES)]);
  const countries = countryRows(countryFeatures);
  const byName = new Map<string, string>();
  for (const row of countries.values()) {
    for (const name of [row.name, ...row.aliases]) byName.set(name.toLowerCase(), row.code);
  }

  const cities = cityFeatures
    .map(({ properties: p }) => {
      const adm0 = str(p, 'adm0name');
      let country = str(p, 'iso_a2');
      if (!/^[A-Z]{2}$/.test(country)) country = byName.get(adm0.toLowerCase()) ?? `~${adm0}`;
      return {
        id: num(p, 'ne_id'),
        name: str(p, 'name'),
        ascii: str(p, 'nameascii'),
        country,
        lat: num(p, 'latitude'),
        lon: num(p, 'longitude'),
        population: twoFigures(num(p, 'pop_max')),
        adm0,
      };
    })
    .filter((city) => city.id > 0 && city.name !== '')
    .sort((a, b) => a.id - b.id);

  // Territories Natural Earth folds into a country at this scale (French
  // Guiana, Réunion…) still need a name for their cities' labels.
  for (const city of cities) {
    if (city.country.startsWith('~') || countries.has(city.country)) continue;
    const name = TERRITORY_NAMES[city.country];
    if (name === undefined) throw new Error(`no country row or territory name for ${city.country}`);
    countries.set(city.country, {
      code: city.country,
      name,
      aliases: [],
      lat: city.lat,
      lon: city.lon,
      radius: TERRITORY_RADIUS_DEG,
      population: 0,
    });
  }

  const list = [...countries.values()].sort((a, b) => a.code.localeCompare(b.code));
  const json = {
    v: 1,
    source:
      'Natural Earth (naturalearthdata.com), public domain. Built by scripts/places/build.ts.',
    countries: {
      code: list.map((c) => c.code),
      name: list.map((c) => c.name),
      aliases: list.map((c) => c.aliases.join(',')),
      lat: list.map((c) => centi(c.lat)),
      lon: list.map((c) => centi(c.lon)),
      radius: list.map((c) => Math.round(c.radius * 10)),
    },
    cities: {
      idDelta: cities.map((c, i) => c.id - (cities[i - 1]?.id ?? 0)),
      name: cities.map((c) => c.name),
      ascii: cities.map((c) => (c.ascii === c.name ? '' : c.ascii)),
      country: cities.map((c) => c.country),
      lat: cities.map((c) => centi(c.lat)),
      lon: cities.map((c) => centi(c.lon)),
      population: cities.map((c) => c.population),
    },
  };
  const text = `${JSON.stringify(json)}\n`;
  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, text, 'utf8');
  console.log(
    `  wrote public/data/places.v1.json: ${list.length} countries, ${cities.length} cities, ` +
      `${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`,
  );
}

await main();
