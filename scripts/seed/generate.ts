/**
 * Generates supabase/seed.sql: 200 fictional stories across the globe and the
 * last 24 hours, each with 1-12 articles from invented outlets.
 *
 *   npm run db:seed:generate    rewrite supabase/seed.sql
 *   npm run db:reset            apply migrations, then this seed
 *
 * Deterministic (seeded PRNG), so the committed file only changes when this
 * script does; tests/seed.test.ts fails if the two drift apart. Times are
 * written as `now() - interval`, so every reset yields a fresh "last 24 hours"
 * however old the file is.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { FREE_TIER_DEFAULTS } from '../../src/core/config.ts';
import { NEWS_CATEGORIES, type NewsCategory } from '../../src/core/nodeBuffer.ts';
import { mulberry32 } from '../../src/core/random.ts';
import { ARCS, CATEGORY_WEIGHTS, SENTIMENT_BASE } from './arcs.ts';
import { HEADLINES, fillTemplate, type HeadlineTemplate } from './headlines.ts';
import { OUTLETS } from './outlets.ts';
import { PLACES, placeLabel, placeNamed, type Place } from './places.ts';
import { seedSql } from './sql.ts';

export interface SeedArticle {
  readonly url: string;
  readonly outlet: string;
  readonly outletCountry: string;
  readonly headline: string;
  readonly snippet: string;
  /** Seconds before now(). */
  readonly ageSec: number;
}

export interface SeedStory {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: number;
  readonly place: Place;
  readonly placeName: string;
  readonly placeSource: 'gdelt' | 'dateline';
  readonly placeConf: number;
  readonly heat: number;
  readonly sentiment: number;
  /** Seconds before now() the story was published, in [0, window). */
  readonly ageSec: number;
  /** Seconds before now() ingest first saw it: a few minutes after publishing. */
  readonly firstSeenAgeSec: number;
  readonly discussionState: 'none' | 'queued';
  readonly articles: readonly SeedArticle[];
}

export interface SeedOptions {
  readonly count: number;
  readonly windowHours: number;
  readonly seed: number;
}

export const DEFAULT_SEED_OPTIONS: SeedOptions = {
  count: 200,
  windowHours: FREE_TIER_DEFAULTS.historyWindowHours,
  seed: 20260924,
};

/** Stories this hot are marked queued, so the admin queue has something in it. */
const QUEUE_HEAT = 215;
const MAX_ARTICLES = 12;
/**
 * Stories span the window minus this, so all of them are still inside it for
 * half an hour after a reset. Without it the oldest start leaving the window
 * within seconds, and "200 stories from the last 24 h" reads 199 a minute later.
 */
export const SEED_HEADROOM_SEC = 30 * 60;
/** Appended to every summary: the one field a reader of the seeded app will see in full. */
export const FICTION_NOTE = 'Fictional seed data.';

type Random = () => number;

function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('seed: pick from an empty list');
  return item;
}

function pickWeighted<T>(random: Random, items: readonly T[], weightOf: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let target = random() * total;
  for (const item of items) {
    target -= weightOf(item);
    if (target < 0) return item;
  }
  return pick(random, items);
}

/** A v4-shaped UUID drawn from the seeded PRNG, so ids are stable across runs. */
function uuidFrom(random: Random): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '');
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Later outlets rarely reuse the lead headline word for word. */
const FOLLOW_UP_PREFIXES = ['Update: ', 'Analysis: ', 'Explainer: ', 'Live: '] as const;

function articlesFor(
  random: Random,
  id: string,
  title: string,
  alt: string,
  snippet: string,
  ageSec: number,
  count: number,
): SeedArticle[] {
  // Distinct outlets per story: shuffle a copy and take the first `count`.
  const outlets = [...OUTLETS];
  for (let i = outlets.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [outlets[i], outlets[j]] = [outlets[j]!, outlets[i]!];
  }

  let age = ageSec;
  return outlets.slice(0, count).map((outlet, k): SeedArticle => {
    const base = k % 2 === 0 ? title : alt;
    const headline = k < 2 ? base : `${FOLLOW_UP_PREFIXES[(k - 2) % 4]}${base}`;
    if (k > 0) age = Math.max(0, age - Math.round(300 + random() * 3300));
    return {
      url: `https://${outlet.domain}/news/${slug(title)}-${id.slice(0, 8)}`,
      outlet: outlet.name,
      outletCountry: outlet.country,
      headline,
      snippet,
      ageSec: age,
    };
  });
}

interface StoryDraft {
  readonly place: Place;
  readonly category: NewsCategory;
  readonly template: HeadlineTemplate;
  readonly ageSec: number;
  readonly heat: number;
}

function story(random: Random, draft: StoryDraft): SeedStory {
  const { place, category, template, ageSec, heat } = draft;
  const id = uuidFrom(random);
  const title = fillTemplate(template.title, place.city, place.country);
  const alt = fillTemplate(template.alt, place.city, place.country);
  const lede = fillTemplate(template.summary, place.city, place.country);
  // Coverage grows with heat: 1 source for a minor story, up to 12 for the hottest.
  const sources = clamp(
    1 + Math.floor((heat / 255) ** 1.2 * (MAX_ARTICLES - 1) * (0.6 + 0.4 * random())),
    1,
    MAX_ARTICLES,
  );
  const dateline = random() < 0.15;
  return {
    id,
    title,
    summary: `${lede} ${FICTION_NOTE}`,
    category: NEWS_CATEGORIES.indexOf(category),
    place,
    placeName: placeLabel(place),
    placeSource: dateline ? 'dateline' : 'gdelt',
    placeConf: dateline ? 80 + Math.floor(random() * 19) : 55 + Math.floor(random() * 41),
    heat,
    sentiment: clamp(Math.round(SENTIMENT_BASE[category] + (random() - 0.5) * 50), -100, 100),
    ageSec,
    firstSeenAgeSec: Math.max(0, ageSec - Math.round(60 + random() * 840)),
    discussionState: heat >= QUEUE_HEAT ? 'queued' : 'none',
    articles: articlesFor(random, id, title, alt, lede, ageSec, sources),
  };
}

export function buildSeed(options: SeedOptions = DEFAULT_SEED_OPTIONS): SeedStory[] {
  const random = mulberry32(options.seed);
  const windowSec = options.windowHours * 3600 - SEED_HEADROOM_SEC;
  const stories: SeedStory[] = [];

  // Developing stories first: the same event reported city after city, so
  // scrubbing the timeline shows it spreading across the globe.
  for (const arc of ARCS) {
    const template = HEADLINES[arc.category][arc.template];
    if (template === undefined) throw new Error(`seed: arc template ${arc.template} missing`);
    arc.stops.forEach(([city, hoursAgo], i) => {
      const place = placeNamed(city);
      const jitter = (random() - 0.5) * 1200;
      const heatRamp = arc.heat[0] + ((arc.heat[1] - arc.heat[0]) * i) / (arc.stops.length - 1);
      stories.push(
        story(random, {
          place,
          category: arc.category,
          template,
          ageSec: Math.round(clamp(hoursAgo * 3600 + jitter, 0, windowSec - 1)),
          heat: Math.round(heatRamp),
        }),
      );
    });
  }

  while (stories.length < options.count) {
    const category = pickWeighted(random, NEWS_CATEGORIES, (c) => CATEGORY_WEIGHTS[c]);
    stories.push(
      story(random, {
        place: pickWeighted(random, PLACES, (p) => p.weight),
        category,
        template: pick(random, HEADLINES[category]),
        ageSec: Math.floor(random() * windowSec),
        // Most stories are minor and a few are hot, roughly as real coverage is.
        heat: Math.floor(255 * random() ** 3),
      }),
    );
  }

  return stories.slice(0, options.count);
}

export const SEED_SQL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../supabase/seed.sql',
);

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stories = buildSeed();
  writeFileSync(SEED_SQL_PATH, seedSql(stories, DEFAULT_SEED_OPTIONS));
  const articles = stories.reduce((sum, s) => sum + s.articles.length, 0);
  console.log(`Wrote ${stories.length} stories and ${articles} articles to ${SEED_SQL_PATH}`);
}
