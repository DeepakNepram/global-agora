import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { Fetch } from '../src/gdelt/feed.ts';
import { normalizeRecord, type IngestArticle } from '../src/normalize/article.ts';
import { fipsToIso, placeName, primaryPlace } from '../src/normalize/location.ts';
import { createOutletCountries } from '../src/normalize/outlets.ts';
import {
  cleanTitle,
  decodeEntities,
  isDigest,
  isSiteName,
  normalizeTitle,
  stripSiteName,
} from '../src/normalize/title.ts';
import { canonicalUrl, resolveRedirect, urlKey } from '../src/normalize/url.ts';

import { fixtureRecord, fixtureRecords } from './helpers.ts';

const outletCountry = createOutletCountries(
  readFileSync(new URL('../src/data/outlet-countries.txt', import.meta.url), 'utf8'),
);

describe('canonical URLs', () => {
  it('drops tracking parameters and fragments, keeps the ones that pick the page', () => {
    expect(
      canonicalUrl('https://example.com/story?id=42&utm_source=x&fbclid=abc&UTM_Medium=y#comments'),
    ).toBe('https://example.com/story?id=42');
  });

  it('drops the default port, as asiaone.com was listed with and without :443', () => {
    const withPort = fixtureRecord('https://www.asiaone.com:443/asia/death-toll');
    const without = fixtureRecord('https://www.asiaone.com/asia/death-toll');
    expect(canonicalUrl(withPort.url)).toBe(canonicalUrl(without.url));
  });

  it('leaves an untracked query exactly as written', () => {
    const url = 'https://www.7newsbelize.com/sstory.php?nid=79990';
    expect(canonicalUrl(url)).toBe(url);
  });

  it('refuses anything that is not a plain web link', () => {
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalUrl('ftp://example.com/a')).toBeNull();
    expect(canonicalUrl('https://user:pw@example.com/a')).toBeNull();
    expect(canonicalUrl('not a url')).toBeNull();
    expect(canonicalUrl(`https://example.com/${'a'.repeat(2100)}`)).toBeNull();
  });

  it('keys ignore scheme, www and a trailing slash', () => {
    expect(urlKey('https://www.example.com/a/b/')).toBe(urlKey('http://example.com/a/b'));
    expect(urlKey('https://example.com/a?x=1')).not.toBe(urlKey('https://example.com/a?x=2'));
  });
});

describe('redirects', () => {
  const chain: Fetch = async (url) => {
    const hops: Record<string, string> = {
      'https://bit.ly/abc': 'https://t.co/xyz',
      'https://t.co/xyz': 'https://news.example/story?utm_source=twitter',
    };
    const location = hops[url];
    return location === undefined
      ? new Response(null, { status: 200 })
      : new Response(null, { status: 301, headers: { location } });
  };

  it('follows shorteners to the article, canonicalized', async () => {
    const budget = { remaining: 10 };
    await expect(resolveRedirect('https://bit.ly/abc', chain, budget)).resolves.toBe(
      'https://news.example/story',
    );
    expect(budget.remaining).toBe(8);
  });

  it('does not fetch ordinary article URLs', async () => {
    const fetchFn = vi.fn<Fetch>(chain);
    await resolveRedirect('https://news.example/story', fetchFn, { remaining: 10 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('stops when the run budget is spent, or the redirector fails', async () => {
    await expect(resolveRedirect('https://bit.ly/abc', chain, { remaining: 1 })).resolves.toBe(
      'https://t.co/xyz',
    );
    const failing: Fetch = async () => {
      throw new Error('network');
    };
    await expect(resolveRedirect('https://bit.ly/abc', failing, { remaining: 5 })).resolves.toBe(
      'https://bit.ly/abc',
    );
  });
});

describe('titles', () => {
  it('decodes the entities real titles carry', () => {
    expect(decodeEntities('Bonded by Ping&#x2011;Pong: China&#x2011;U.S.')).toBe(
      'Bonded by Ping‑Pong: China‑U.S.',
    );
    expect(decodeEntities('Fish &amp; chips &#39;n&#39; &unknown; &#xD800;')).toBe(
      "Fish & chips 'n' &unknown; &#xD800;",
    );
  });

  it('strips site names from real titles', () => {
    expect(
      stripSiteName(
        "Judge Temporarily Lifts Trump's White House Media Ban | NewsRadio 1450/1370 WKIP",
        'iheart.com',
      ),
    ).toBe("Judge Temporarily Lifts Trump's White House Media Ban");
    expect(
      stripSiteName("Xinhua News | China's FAST telescope discovers pulsars", 'english.news.cn'),
    ).toBe("China's FAST telescope discovers pulsars");
    expect(
      stripSiteName('Man charged after crash - Swindon Advertiser', 'swindonadvertiser.co.uk'),
    ).toBe('Man charged after crash');
  });

  it('keeps a dash that is part of the headline', () => {
    const title = 'Didcot - Man in his 50s to face sexual assault trial in 2028';
    expect(stripSiteName(title, 'oxfordmail.co.uk')).toBe(title);
  });

  it('recognizes a title that is only the site name', () => {
    expect(isSiteName('7 News Belize', '7newsbelize.com')).toBe(true);
    expect(isSiteName('Belize flooding worsens', '7newsbelize.com')).toBe(false);
  });

  it('recognizes wire digests', () => {
    expect(isDigest('AP News Summary at 3:30 a.m. EDT')).toBe(true);
    expect(isDigest('AP News in Brief at 12:04 a.m. EDT')).toBe(true);
    expect(isDigest('Judge blocks media ban')).toBe(false);
  });

  it('gives a headline, or the reason there is none', () => {
    expect(cleanTitle(null, 'x.com')).toEqual({ ok: false, reason: 'no_title' });
    expect(cleanTitle('Breaking news', 'x.com')).toEqual({ ok: false, reason: 'short_title' });
    const long = cleanTitle(`Headline ${'word '.repeat(100)}`, 'x.com');
    expect(long.ok && long.headline.length).toBeLessThanOrEqual(300);
    expect(long.ok && long.headline.endsWith('…')).toBe(true);
  });

  it('normalizes for comparison', () => {
    expect(normalizeTitle("Côte d’Ivoire: Trump's ban — lifted!")).toBe(
      'cote divoire trumps ban lifted',
    );
  });
});

describe('places', () => {
  it('picks the most precise, most mentioned place', () => {
    const place = primaryPlace(fixtureRecord('https://www.kccu.org/business/').locations);
    expect(place).toMatchObject({ name: 'White House, District Of Columbia, United States' });
    expect(place?.countryCode).toBe('US');
    expect(place?.type).toBe(3);
  });

  it('converts GDELT FIPS codes to ISO', () => {
    expect(fipsToIso('AS')).toBe('AU'); // FIPS AS is Australia; ISO AS is American Samoa
    expect(fipsToIso('AU')).toBe('AT');
    expect(fipsToIso('UK')).toBe('GB');
    expect(fipsToIso('ZZ')).toBeNull();
  });

  it('tidies repeated name parts', () => {
    expect(placeName('Washington, Washington, United States')).toBe('Washington, United States');
  });

  it('has no place when GDELT gave none', () => {
    expect(
      primaryPlace(fixtureRecord('https://www.leaderlive.co.uk/news/national/26577160').locations),
    ).toBeNull();
  });
});

describe('outlet countries', () => {
  it('finds generic-TLD outlets in the GDELT list', () => {
    expect(outletCountry('nypost.com')).toBe('US');
    expect(outletCountry('samaa.tv')).toBe('PK');
  });

  it('falls back to the country-code TLD', () => {
    expect(outletCountry('leaderlive.co.uk')).toBe('GB');
    expect(outletCountry('goulburnpost.com.au')).toBe('AU');
    expect(outletCountry('english.news.cn')).toBe('CN');
  });

  it('says nothing for an unknown .com or a vanity ccTLD', () => {
    expect(outletCountry('surely-not-a-real-outlet-9431.com')).toBeNull();
    expect(outletCountry('unknown-station.fm')).toBeNull();
  });
});

describe('normalizeRecord (real rows)', () => {
  const results = fixtureRecords().map((record) => normalizeRecord(record, { outletCountry }));
  const skipped = results.flatMap((r) => (r.ok ? [] : [r.reason])).sort();
  const articles = results.flatMap((r): IngestArticle[] => (r.ok ? [r.article] : []));

  it('skips exactly the stale re-crawl, the digest and the site-name page', () => {
    expect(skipped).toEqual(['digest', 'site_name', 'stale']);
  });

  it('keeps unplaced articles, so they can join a placed story', () => {
    expect(articles.filter((a) => a.place === null).length).toBeGreaterThan(0);
  });

  it('fills every field the database needs', () => {
    for (const article of articles) {
      expect(article.url).toMatch(/^https?:\/\//);
      expect(article.headline.length).toBeGreaterThan(0);
      expect(article.headline.length).toBeLessThanOrEqual(300);
      expect(article.publishedAt).toBeLessThanOrEqual(article.seenAt + 15 * 60);
      expect(article.seenAt - article.publishedAt).toBeLessThanOrEqual(48 * 3600);
    }
  });

  it('never takes a publish time from the future', () => {
    const record = { ...fixtureRecord('https://www.newsitem.com/') };
    const future = normalizeRecord(
      { ...record, publishedAt: record.seenAt + 3600 },
      { outletCountry },
    );
    expect(future.ok && future.article.publishedAt).toBe(record.seenAt);
  });
});
