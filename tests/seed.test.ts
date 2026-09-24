import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { NEWS_CATEGORIES } from '../src/core/nodeBuffer';
import {
  buildSeed,
  DEFAULT_SEED_OPTIONS,
  FICTION_NOTE,
  SEED_HEADROOM_SEC,
  SEED_SQL_PATH,
} from '../scripts/seed/generate.ts';
import { placeNamed, PLACES } from '../scripts/seed/places.ts';
import { seedSql } from '../scripts/seed/sql.ts';

const stories = buildSeed();
const articles = stories.flatMap((story) => story.articles);
const windowSec = DEFAULT_SEED_OPTIONS.windowHours * 3600;

describe('database seed', () => {
  it('has 200 stories that stay inside the history window for a while after a reset', () => {
    expect(stories).toHaveLength(200);
    for (const story of stories) {
      expect(story.ageSec).toBeGreaterThanOrEqual(0);
      expect(story.ageSec).toBeLessThan(windowSec - SEED_HEADROOM_SEC);
      expect(story.firstSeenAgeSec).toBeLessThanOrEqual(story.ageSec);
    }
  });

  it('spreads across the whole window, not a single burst', () => {
    const hours = new Set(stories.map((story) => Math.floor(story.ageSec / 3600)));
    expect(hours.size).toBe(DEFAULT_SEED_OPTIONS.windowHours);
  });

  it('reaches every continent, Antarctica included', () => {
    const regions = new Set(stories.map((story) => story.place.region));
    expect([...regions].sort()).toEqual([...new Set(PLACES.map((p) => p.region))].sort());
  });

  it('is deterministic', () => {
    expect(buildSeed()).toEqual(stories);
  });

  it('writes only values the schema accepts', () => {
    for (const story of stories) {
      expect(story.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(story.category).toBeGreaterThanOrEqual(0);
      expect(story.category).toBeLessThan(NEWS_CATEGORIES.length);
      expect(Math.abs(story.place.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(story.place.lon)).toBeLessThanOrEqual(180);
      expect(story.place.code).toMatch(/^[A-Z]{2}$/);
      expect(story.heat).toBeGreaterThanOrEqual(0);
      expect(story.heat).toBeLessThanOrEqual(255);
      expect(Math.abs(story.sentiment)).toBeLessThanOrEqual(100);
      expect(story.placeConf).toBeGreaterThanOrEqual(0);
      expect(story.placeConf).toBeLessThanOrEqual(100);
      expect(story.title.length).toBeLessThanOrEqual(300);
      expect(story.summary.length).toBeLessThanOrEqual(600);
      expect(story.placeName.length).toBeLessThanOrEqual(120);
      expect(story.articles.length).toBeGreaterThanOrEqual(1);
      expect(story.articles.length).toBeLessThanOrEqual(12);
    }
    for (const article of articles) {
      expect(article.headline.length).toBeLessThanOrEqual(300);
      expect(article.snippet.length).toBeLessThanOrEqual(400);
      expect(article.outletCountry).toMatch(/^[A-Z]{2}$/);
    }
    expect(new Set(stories.map((story) => story.id)).size).toBe(stories.length);
    expect(new Set(articles.map((article) => article.url)).size).toBe(articles.length);
  });

  it('marks itself as fiction and links nowhere real', () => {
    for (const story of stories) expect(story.summary.endsWith(FICTION_NOTE)).toBe(true);
    for (const article of articles) {
      const url = new URL(article.url);
      expect(url.protocol).toBe('https:');
      // RFC 2606 reserves .example, so no seeded link can resolve to a real site.
      expect(url.hostname.endsWith('.example')).toBe(true);
    }
  });

  it('escapes quotes in place names', () => {
    const [first] = stories;
    if (first === undefined) throw new Error('no stories');
    const place = placeNamed("N'Djamena");
    const sql = seedSql([{ ...first, place, placeName: "N'Djamena, Chad" }], DEFAULT_SEED_OPTIONS);
    expect(sql).toContain("'N''Djamena, Chad'");
    expect(sql).not.toContain("'N'Djamena");
  });

  it('matches the committed supabase/seed.sql', () => {
    // Regenerate with `npm run db:seed:generate` after changing the generator.
    const committed = readFileSync(SEED_SQL_PATH, 'utf8').replaceAll('\r\n', '\n');
    expect(committed).toBe(seedSql(stories, DEFAULT_SEED_OPTIONS));
  });
});
