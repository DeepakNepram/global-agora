import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { NEWS_CATEGORIES, type NewsCategory } from '../../../src/core/nodeBuffer.ts';
import {
  clusterArticles,
  clusterWriteups,
  groupWriteups,
  type Cluster,
} from '../src/dedup/cluster.ts';
import { normalizeRecord, type IngestArticle } from '../src/normalize/article.ts';
import { createOutletCountries } from '../src/normalize/outlets.ts';
import { categoryScores, pickCategory } from '../src/score/category.ts';
import {
  DEFAULT_HEAT,
  heatScore,
  independentSources,
  saturate,
  type HeatInputs,
} from '../src/score/heat.ts';

import { fixtureRecords } from './helpers.ts';

const outletCountry = createOutletCountries(
  readFileSync(new URL('../src/data/outlet-countries.txt', import.meta.url), 'utf8'),
);
const articles: IngestArticle[] = fixtureRecords().flatMap((record) => {
  const result = normalizeRecord(record, { outletCountry });
  return result.ok ? [result.article] : [];
});
const clusters = clusterWriteups(groupWriteups(articles).writeups);

/** Heat inputs for a fixture cluster, the way the pipeline counts them. */
function inputsFor(cluster: Cluster): HeatInputs {
  const members = clusterArticles(cluster);
  const now = Math.max(...members.map((a) => a.seenAt));
  const outlets = new Set(members.map((a) => a.outlet));
  const countries = new Set(
    members.flatMap((a) => (a.outletCountry === null ? [] : [a.outletCountry])),
  );
  const recent = new Set(members.filter((a) => a.seenAt > now - 3600).map((a) => a.outlet));
  return {
    writeups: cluster.writeups.length,
    outlets: outlets.size,
    countries: countries.size,
    velocity: recent.size,
  };
}

const clusterOf = (urlPrefix: string): Cluster => {
  const found = clusters.find((c) => clusterArticles(c).some((a) => a.url.startsWith(urlPrefix)));
  if (found === undefined) throw new Error(`no cluster for ${urlPrefix}`);
  return found;
};

describe('heat formula', () => {
  it('saturates logarithmically', () => {
    expect(saturate(0, 19)).toBe(0);
    expect(saturate(-3, 19)).toBe(0);
    expect(saturate(19, 19)).toBe(1);
    expect(saturate(100, 19)).toBe(1);
    expect(saturate(4, 49) - saturate(0, 49)).toBeGreaterThan(saturate(49, 49) - saturate(39, 49));
  });

  it('counts syndicated copies at a quarter', () => {
    expect(independentSources(1, 42, 0.25)).toBe(11.25);
    expect(independentSources(10, 10, 0.25)).toBe(10);
    // A second write-up on the same outlet does not make it two sources.
    expect(independentSources(3, 2, 0.25)).toBe(2);
  });

  it('scores one article from one outlet at 10, and wide fast coverage at 255', () => {
    expect(heatScore({ writeups: 1, outlets: 1, countries: 1, velocity: 1 })).toBe(10);
    expect(heatScore({ writeups: 1, outlets: 1, countries: 1, velocity: 0 })).toBe(0);
    expect(heatScore({ writeups: 50, outlets: 50, countries: 16, velocity: 30 })).toBe(255);
    expect(heatScore({ writeups: 20, outlets: 20, countries: 8, velocity: 15 })).toBeLessThan(255);
    expect(heatScore({ writeups: 90, outlets: 300, countries: 60, velocity: 200 })).toBe(255);
  });

  it('ranks ten newsrooms in four countries above one wire story on 42 papers', () => {
    const wire = heatScore({ writeups: 1, outlets: 42, countries: 1, velocity: 42 });
    const independent = heatScore({ writeups: 10, outlets: 10, countries: 4, velocity: 10 });
    expect(independent).toBeGreaterThan(wire);
  });

  it('never falls when any input rises', () => {
    const base: HeatInputs = { writeups: 3, outlets: 5, countries: 2, velocity: 3 };
    for (const key of ['writeups', 'outlets', 'countries', 'velocity'] as const) {
      expect(heatScore({ ...base, [key]: base[key] + 1 })).toBeGreaterThanOrEqual(heatScore(base));
    }
  });

  it('takes its weights from config', () => {
    const inputs = { writeups: 5, outlets: 5, countries: 1, velocity: 0 };
    const sourcesOnly = { ...DEFAULT_HEAT, weights: { sources: 1, countries: 0, velocity: 0 } };
    expect(heatScore(inputs, sourcesOnly)).toBe(Math.round(255 * saturate(4, 49)));
  });
});

describe('heat on real clusters', () => {
  const heats = clusters.map((c) => ({ c, heat: heatScore(inputsFor(c)) }));

  it('makes the White House ruling the hottest story in the fixture', () => {
    const ruling = heatScore(inputsFor(clusterOf('https://www.kccu.org/business/')));
    expect(ruling).toBe(Math.max(...heats.map((h) => h.heat)));
    expect(ruling).toBeGreaterThan(150);
  });

  it('keeps a lone article near the floor', () => {
    const nepal = heatScore(inputsFor(clusterOf('https://www.newindianexpress.com/')));
    expect(nepal).toBeLessThanOrEqual(10);
  });

  it('stays inside 0-255', () => {
    for (const { heat } of heats) {
      expect(heat).toBeGreaterThanOrEqual(0);
      expect(heat).toBeLessThanOrEqual(255);
      expect(Number.isInteger(heat)).toBe(true);
    }
  });
});

describe('categories', () => {
  const categoryOfArticles = (list: readonly IngestArticle[]): NewsCategory => {
    const sums = NEWS_CATEGORIES.map(() => 0);
    for (const article of list) {
      categoryScores(article.themes).forEach((score, i) => (sums[i] = (sums[i] ?? 0) + score));
    }
    return NEWS_CATEGORIES[pickCategory(sums, list.length)] ?? 'world';
  };

  /** Real headlines from the fixture, labelled by hand. */
  const labelled: [urlPrefix: string, expected: NewsCategory][] = [
    ['https://www.crookwellgazette.com.au/story/9357040', 'conflict'],
    ['https://www.kccu.org/world/2026-09-23/fears-of-return-to-war', 'conflict'],
    ['https://nypost.com/2026/09/24/world-news/ukraine', 'conflict'],
    ['https://morningstaronline.co.uk/article/south-sudan', 'politics'],
    ['https://kansaspublicradio.org/npr-news/2026-09-24/venezuelas', 'politics'],
    ['https://www.leaderlive.co.uk/news/national/26577214', 'politics'],
    ['https://www.news4jax.com/business/2026/09/24/asian-shares', 'business'],
    ['https://www.leaderlive.co.uk/news/national/26577160', 'business'],
    ['https://www.news4jax.com/business/2026/09/24/senators-to-question-fda', 'health'],
    ['https://www.theguardian.com/environment/', 'climate'],
    ['https://www.vol.at/new-weather-forecast', 'climate'],
    ['https://www.asiaone.com/asia/death-toll-capsized', 'world'],
    ['https://www.newindianexpress.com/world/2026/Sep/24/nepal', 'world'],
    ['https://en.people.cn/n3/2026/0924/c90000-20503366', 'world'],
    // Known misses, kept so the accuracy figure stays honest: GDELT tagged the
    // telescope story with no science theme, and tagged the other two with
    // stronger health themes than tech ones.
    ['https://english.news.cn/20260924/b8db66866eec4b24b4b142f84ee4f37e', 'science'],
    ['https://www.yumasun.com/news/national_news/as-the-coding-boom', 'tech'],
    ['https://www.echo-news.co.uk/news/national/26577114', 'tech'],
  ];

  it('agrees with hand labels on at least 80% of real headlines', () => {
    const results = labelled.map(([prefix, expected]) => {
      const article = articles.find((a) => a.url.startsWith(prefix));
      if (article === undefined) throw new Error(`no fixture row for ${prefix}`);
      return { prefix, expected, got: categoryOfArticles([article]) };
    });
    const misses = results.filter((r) => r.got !== r.expected);
    expect(misses.map((m) => m.prefix)).toEqual([
      'https://english.news.cn/20260924/b8db66866eec4b24b4b142f84ee4f37e',
      'https://www.yumasun.com/news/national_news/as-the-coding-boom',
      'https://www.echo-news.co.uk/news/national/26577114',
    ]);
    expect(1 - misses.length / results.length).toBeGreaterThanOrEqual(0.8);
  });

  it('categorizes whole stories from all their articles', () => {
    expect(categoryOfArticles(clusterArticles(clusterOf('https://www.kccu.org/business/')))).toBe(
      'politics',
    );
    expect(categoryOfArticles(clusterArticles(clusterOf('https://www.samaa.tv/2087357312')))).toBe(
      'politics',
    );
  });

  it('falls back to world when no theme is clear', () => {
    expect(pickCategory([0, 0, 4, 0, 0, 0, 0, 0], 1)).toBe(0);
    expect(pickCategory([0, 0, 12, 0, 0, 0, 0, 0], 3)).toBe(0);
    expect(pickCategory([0, 0, 15, 0, 0, 0, 0, 0], 3)).toBe(2);
    expect(pickCategory([0, 0, 0, 0, 0, 0, 0, 0], 0)).toBe(0);
  });
});
