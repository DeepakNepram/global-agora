import { NEWS_CATEGORIES } from '@/core/nodeBuffer';
import { quantizeLat, quantizeLon, type NodesPayload } from '@/core/data/payload';

/**
 * The news the accessibility checks browse (Prompt 5.1): 120 stories over
 * the last day, across the world, in every category, as the API Worker
 * serves them. Deterministic, so every run sees the same page; built
 * against the app's own payload types, so a format change fails the
 * typecheck rather than the checks.
 */

const HOUR = 3600;
const WINDOW_HOURS = 24;
const COUNT = 120;

/** Story 7's discussion is open: the checks enter it. */
export const OPEN_DISCUSSION_SEQ = 7;
export const OPEN_DISCUSSION_UUID = '00000000-0000-4000-8000-000000000007';

const PLACES: readonly (readonly [string, string, number, number])[] = [
  ['London, United Kingdom', 'GB', 51.51, -0.13],
  ['Paris, France', 'FR', 48.86, 2.35],
  ['Nairobi, Kenya', 'KE', -1.29, 36.82],
  ['Tokyo, Japan', 'JP', 35.68, 139.69],
  ['São Paulo, Brazil', 'BR', -23.55, -46.63],
  ['Delhi, India', 'IN', 28.61, 77.21],
  ['Sydney, Australia', 'AU', -33.87, 151.21],
  ['New York, United States', 'US', 40.71, -74.01],
  ['Cairo, Egypt', 'EG', 30.04, 31.24],
  ['Mexico City, Mexico', 'MX', 19.43, -99.13],
  ['Jakarta, Indonesia', 'ID', -6.21, 106.85],
  ['Lagos, Nigeria', 'NG', 6.52, 3.38],
];

const SUBJECTS = [
  'Talks resume',
  'Storm warning issued',
  'Markets rally',
  'New vaccine trial begins',
  'Elections called',
  'Heatwave breaks records',
  'Startup unveils chip',
  'Ceasefire holds',
] as const;

/** A small, fixed sequence: every run lays the stories out alike. */
function jitter(i: number, scale: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * scale;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface Story {
  readonly seq: number;
  readonly title: string;
  readonly category: (typeof NEWS_CATEGORIES)[number];
  readonly place: string;
  readonly countryCode: string;
  readonly lat: number;
  readonly lon: number;
  readonly publishedSec: number;
  readonly heat: number;
  readonly sources: number;
}

/** The stories, newest last, published over the window that ends now. */
export function stories(now = nowSeconds()): Story[] {
  return Array.from({ length: COUNT }, (_, i) => {
    const [place, countryCode, lat, lon] = PLACES[i % PLACES.length] ?? PLACES[0] ?? ['', '', 0, 0];
    const category = NEWS_CATEGORIES[i % NEWS_CATEGORIES.length] ?? 'world';
    const city = place.split(',')[0] ?? place;
    return {
      seq: i + 1,
      title: `${SUBJECTS[i % SUBJECTS.length] ?? 'News'} in ${city}`,
      category,
      place,
      countryCode,
      lat: lat + jitter(i, 6),
      lon: lon + jitter(i + 99, 6),
      // Spread over the window, the newest a few minutes old.
      publishedSec: now - 300 - Math.floor(((COUNT - 1 - i) / COUNT) * (WINDOW_HOURS - 1) * HOUR),
      heat: 40 + ((i * 37) % 200),
      sources: 1 + ((i * 7) % 30),
    };
  });
}

/** GET /api/nodes, as the Worker answers it. */
export function nodesPayload(now = nowSeconds()): NodesPayload {
  const all = stories(now);
  const epoch = now - WINDOW_HOURS * HOUR;
  return {
    v: 1,
    generated_at: now,
    window_hours: WINDOW_HOURS,
    categories: [...NEWS_CATEGORIES],
    nodes: {
      id: all.map((s) => s.seq),
      lonQ: all.map((s) => quantizeLon(s.lon)),
      latQ: all.map((s) => quantizeLat(s.lat)),
      t: all.map((s) => s.publishedSec - epoch),
      cat: all.map((s) => NEWS_CATEGORIES.indexOf(s.category)),
      heat: all.map((s) => s.heat),
      srcN: all.map((s) => s.sources),
      disc: all.map((s) => (s.seq === OPEN_DISCUSSION_SEQ ? 1 : 0)),
      hl: all.map((s) => s.title),
      pl: all.map((s) => s.place),
      cc: all.map((s) => s.countryCode),
    },
  };
}

/** GET /api/story/:seq, as the Worker answers it (parseStory reads this). */
export function storyDetail(seq: number, now = nowSeconds()): Record<string, unknown> | null {
  const story = stories(now).find((s) => s.seq === seq);
  if (!story) return null;
  const published = new Date(story.publishedSec * 1000).toISOString();
  const open = seq === OPEN_DISCUSSION_SEQ;
  return {
    seq,
    id: open ? OPEN_DISCUSSION_UUID : `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    title: story.title,
    summary: null,
    category: story.category,
    heat: story.heat,
    source_count: story.sources,
    published_at: published,
    first_seen_at: published,
    place: {
      name: story.place,
      lat: story.lat,
      lon: story.lon,
      source: 'gdelt',
      confidence: 70,
      country_code: story.countryCode,
    },
    discussion: { state: open ? 'open' : 'none', participants: open ? 3 : null },
    article_count: 2,
    articles: [
      {
        outlet: 'harbour-gazette.example',
        outlet_country: story.countryCode,
        headline: story.title,
        url: `https://harbour-gazette.example/story/${seq}`,
        published_at: published,
        snippet: 'A short line from the article, as the outlet published it.',
      },
      {
        outlet: 'morning-wire.example',
        outlet_country: null,
        headline: `${story.title}, officials say`,
        url: `https://morning-wire.example/${seq}`,
        published_at: published,
        snippet: null,
      },
    ],
  };
}

/** GET /api/outlets, the outlet search's index. */
export function outletsIndex(now = nowSeconds()): Record<string, unknown> {
  return {
    v: 1,
    generated_at: now,
    window_hours: WINDOW_HOURS,
    outlets: ['harbour-gazette.example', 'morning-wire.example'],
    n: [COUNT, COUNT],
  };
}

/**
 * A small equirectangular texture: the real ones are gitignored downloads,
 * absent in CI, and the checks are about the page, not the picture.
 */
export async function tinyTexture(): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  return sharp({ create: { width: 8, height: 4, channels: 3, background: '#1d3557' } })
    .png()
    .toBuffer();
}
