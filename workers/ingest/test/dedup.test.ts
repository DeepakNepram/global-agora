import { describe, expect, it } from 'vitest';

import {
  clusterArticles,
  clusterWriteups,
  groupWriteups,
  type Cluster,
} from '../src/dedup/cluster.ts';
import { eventKeys, personKey, sameEvent, stem, titleWordKeys } from '../src/dedup/keys.ts';
import {
  bands,
  fromHex,
  hamming,
  isNearDuplicate,
  simhash,
  toBigintString,
  toHex,
} from '../src/dedup/simhash.ts';
import { normalizeRecord, type IngestArticle } from '../src/normalize/article.ts';
import { normalizeTitle } from '../src/normalize/title.ts';

import { fixtureRecords } from './helpers.ts';

/** The fixture's rows as articles; URL de-duplication is the pipeline's job, not tested here. */
const articles: IngestArticle[] = fixtureRecords().flatMap((record) => {
  const result = normalizeRecord(record, { outletCountry: () => null });
  return result.ok ? [result.article] : [];
});

const hashOf = (title: string): ReturnType<typeof simhash> => simhash(normalizeTitle(title));

describe('simhash', () => {
  it('is identical for identical titles and near for syndicated variants', () => {
    const base = 'Judge orders White House to restore access to news outlets Trump banned';
    expect(hamming(hashOf(base), hashOf(base))).toBe(0);
    // Punctuation and case vanish in normalization.
    expect(hamming(hashOf(base), hashOf(base.toUpperCase() + '!'))).toBe(0);
    expect(
      isNearDuplicate(
        hashOf('Sensex tumbles over 600 points, Nifty below 23,300 amid surge in US bond yields'),
        hashOf('Sensex tumbles over 600 points; Nifty below 23,300 amid surge in US bond yields'),
      ),
    ).toBe(true);
  });

  it('keeps reworded headlines apart (measured: ~20 bits)', () => {
    expect(
      hamming(
        hashOf('Judge orders White House to restore access to news outlets Trump banned'),
        hashOf("Judge temporarily lifts Trump's White House media ban"),
      ),
    ).toBeGreaterThan(3);
  });

  it('round-trips through hex and the signed 64-bit database column', () => {
    const hash = hashOf('Pakistan hits Afghanistan sites after drone attacks');
    expect(fromHex(toHex(hash))).toEqual(hash);
    expect(fromHex('not hex')).toBeNull();
    expect(toBigintString({ hi: 0xffffffff, lo: 0xffffffff })).toBe('-1');
    expect(toBigintString({ hi: 0x7fffffff, lo: 0xffffffff })).toBe('9223372036854775807');
    expect(toBigintString({ hi: 0, lo: 42 })).toBe('42');
  });

  it('bands guarantee near-duplicates share a bucket', () => {
    const hash = hashOf(
      'Albanese rebukes OpenAI after Australian health department website infiltrated',
    );
    const flipped = { hi: (hash.hi ^ 0x80008000) >>> 0, lo: (hash.lo ^ 0x00000001) >>> 0 };
    expect(hamming(hash, flipped)).toBe(3);
    const shared = bands(hash).filter((band, i) => band === bands(flipped)[i]);
    expect(shared.length).toBeGreaterThan(0);
  });
});

describe('event keys', () => {
  it('reduces a person to first initial and surname', () => {
    expect(personKey('timothy j kelly')).toBe('p:t kelly');
    expect(personKey('tim kelly')).toBe('p:t kelly');
    expect(personKey('theodore boutrous jr')).toBe('p:t boutrous');
    expect(personKey('madonna')).toBe('p:madonna');
  });

  it('stems plurals and possessives only', () => {
    expect(stem('trumps')).toBe('trump');
    expect(stem('countries')).toBe('country');
    expect(stem('access')).toBe('access');
  });

  it('keeps short names but drops function words and numbers', () => {
    expect(
      titleWordKeys(normalizeTitle('Trump welcomes Xi to Washington for US-China summit, 2026')),
    ).toEqual(['w:trump', 'w:welcome', 'w:xi', 'w:washington', 'w:china', 'w:summit']);
  });

  it('leaves out keys too common to identify an event', () => {
    const summit = articles.find((a) => a.headline.startsWith('Trump welcomes Xi'));
    expect(summit).toBeDefined();
    const keys = eventKeys(summit as IngestArticle);
    expect(keys).toContain('w:xi');
    expect(keys).not.toContain('w:trump');
    expect(keys).not.toContain('p:d trump');
  });

  it('needs two headline words and one actor in common', () => {
    expect(sameEvent(['w:judge', 'w:ban', 'p:t kelly'])).toBe(true);
    // Every AAP story carries these two organizations; that glued unrelated stories.
    expect(sameEvent(['o:australian associated', 'o:national news'])).toBe(false);
    expect(sameEvent(['w:judge', 'w:ban'])).toBe(false);
    expect(sameEvent(['w:judge', 'p:t kelly'])).toBe(false);
  });
});

describe('write-ups (real rows)', () => {
  const { writeups, sameOutletDuplicates } = groupWriteups(articles);
  const writeupOf = (urlPrefix: string): IngestArticle[] =>
    writeups.find((w) => w.articles.some((a) => a.url.startsWith(urlPrefix)))?.articles ?? [];

  it('joins syndicated copies of one story across outlets', () => {
    const newsquest = writeupOf('https://www.leaderlive.co.uk/news/national/26577103');
    expect(newsquest.map((a) => a.outlet).sort()).toEqual([
      'barryanddistrictnews.co.uk',
      'leaderlive.co.uk',
    ]);
    expect(
      writeupOf('https://www.crookwellgazette.com.au/')
        .map((a) => a.outlet)
        .sort(),
    ).toEqual(['crookwellgazette.com.au', 'goulburnpost.com.au']);
  });

  it('matches a copy whose title carries the station name', () => {
    // Three iHeart stations ran it, one titled "… | NewsRadio 1450/1370 WKIP".
    // The suffix goes, all three match, and iheart.com keeps one copy.
    const iheart = writeups.filter((w) =>
      w.articles.some((a) => a.outlet === 'iheart.com' && /Media Ban/.test(a.headline)),
    );
    expect(iheart).toHaveLength(1);
    expect(iheart[0]?.articles.filter((a) => a.outlet === 'iheart.com')).toHaveLength(1);
    expect(sameOutletDuplicates).toBeGreaterThanOrEqual(2);
  });

  it('drops a second copy on the same outlet', () => {
    for (const writeup of writeups) {
      const outlets = writeup.articles.map((a) => a.outlet);
      expect(new Set(outlets).size).toBe(outlets.length);
    }
  });
});

describe('events (real rows)', () => {
  const clusters = clusterWriteups(groupWriteups(articles).writeups);
  const clusterOf = (urlPrefix: string): Cluster | undefined =>
    clusters.find((c) => clusterArticles(c).some((a) => a.url.startsWith(urlPrefix)));
  const outletsOf = (cluster: Cluster | undefined): string[] =>
    cluster === undefined ? [] : clusterArticles(cluster).map((a) => a.outlet);

  it('groups the White House ruling across its different headlines', () => {
    const ruling = clusterOf('https://www.kccu.org/business/');
    expect(ruling?.writeups.length).toBeGreaterThanOrEqual(6);
    for (const outlet of [
      'newsitem.com',
      'nbcnewyork.com',
      'euronews.com',
      'wdsu.com',
      'punchng.com',
    ]) {
      expect(outletsOf(ruling)).toContain(outlet);
    }
  });

  it('keeps the unrelated Trump-Xi summit out of it', () => {
    const ruling = clusterOf('https://www.kccu.org/business/');
    const summit = clusterOf('https://www.samaa.tv/2087357312');
    expect(summit).toBeDefined();
    expect(summit).not.toBe(ruling);
    const headlines = clusterArticles(summit as Cluster).map((a) => a.headline);
    expect(headlines.every((h) => !/judge/i.test(h))).toBe(true);
  });

  it('joins the two write-ups of the Ukraine prisoner story', () => {
    expect(clusterOf('https://nypost.com/2026/09/24/world-news/ukraine')).toBe(
      clusterOf('https://www.asiaone.com/asia/ukraine-sent'),
    );
  });

  it('never puts one article in two clusters', () => {
    const urls = clusters.flatMap((c) => clusterArticles(c).map((a) => a.url));
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.length).toBe(articles.length - groupWriteups(articles).sameOutletDuplicates);
  });

  it('does not depend on input order', () => {
    const shape = (list: Cluster[]): string[] =>
      list
        .map((c) =>
          clusterArticles(c)
            .map((a) => a.url)
            .sort()
            .join(' '),
        )
        .sort();
    const reversed = clusterWriteups(groupWriteups([...articles].reverse()).writeups);
    expect(shape(reversed)).toEqual(shape(clusters));
  });
});
