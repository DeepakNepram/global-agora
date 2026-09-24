/**
 * Builds workers/ingest/test/fixtures/gkg-sample.tsv from real GKG files.
 *
 *   node --experimental-strip-types scripts/ingest/make-fixture.ts
 *
 * The rows are real, picked by URL from four 2026-09-24 slots to cover what the
 * tests need: one event under many headlines, syndicated copies, copies with no
 * location, an unrelated story sharing names, stale re-crawls, site-name
 * titles, a digest page, and a spread of categories. GDELT archives every slot,
 * so this reproduces the same file.
 *
 * Columns the pipeline never reads are blanked to keep the fixture small (GCAM
 * alone is ~13 KB a row). Every row keeps all 27 columns, so the parser sees
 * the real shape.
 */

import { writeFileSync } from 'node:fs';

import { GKG_COLUMNS, COL, extraTag } from '../../workers/ingest/src/gdelt/gkg.ts';
import { createFeed } from '../../workers/ingest/src/gdelt/feed.ts';

const BASE = 'https://data.gdeltproject.org/gdeltv2';
const OUT = 'workers/ingest/test/fixtures/gkg-sample.tsv';

/** Slot -> URLs to keep, in the order they appear in the fixture. */
const PICKS: Record<string, string[]> = {
  '20260924080000': [
    // One event, many write-ups: the White House press-access ruling.
    'https://www.kccu.org/business/2026-09-24/judge-orders-trump-administration-to-restore-jour',
    'https://kansaspublicradio.org/npr-news/2026-09-24/judge-orders-trump-administration-to-res',
    'https://www.newsitem.com/ap/business/judge-blocks-trumps-ban-and-says-cnn-ms-now-and-polit',
    'http://www.rockymounttelegram.com/features/entertainment/judge-blocks-trumps-ban-and-says-',
    'https://www.wdbo.com/news/politics/judge-orders-white/',
    'https://www.nbcnewyork.com/news/national-international/judge-orders-white-house-restore-ac',
    'https://www.nbcchicago.com/news/national-international/judge-orders-white-house-restore-ac',
    'https://wrak.iheart.com/content/2026-09-24-judge-temporarily-lifts-trumps-white-house-medi',
    'https://kste.iheart.com/content/2026-09-24-judge-temporarily-lifts-trumps-white-house-medi',
    'https://1450wkip.iheart.com/content/2026-09-24-judge-temporarily-lifts-trumps-white-house-',
    'https://www.leaderlive.co.uk/news/national/26577103.judge-orders-white-house-restore-acces',
    'https://www.barryanddistrictnews.co.uk/news/national/26577103.judge-orders-white-house-res',
    'https://www.businessinsider.com/trump-white-house-media-ban-cnn-politico-msnow-judge-block',
    'https://www.channelnewsasia.com/world/judge-block-trump-us-media-white-house-ban-access-re',
    'https://www.thehindubusinessline.com/news/world/judge-blocks-trumps-white-house-media-ban-',
    'https://www.euronews.com/2026/09/24/judge-orders-trump-to-restore-cnn-politico-and-ms-nows',
    'https://www.samaa.tv/2087357320-judge-blocks-trump-s-media-ban-orders-access-be-restored',
    // A different event with the same president in it: the US-China summit.
    'https://www.leaderlive.co.uk/news/national/26577214.trump-welcomes-chinas-leader-ahead-vit',
    'https://www.runcornandwidnesworld.co.uk/news/national/26577214.trump-welcomes-chinas-leade',
    'https://www.surreycomet.co.uk/news/national/26577214.trump-welcomes-chinas-leader-ahead-vi',
    'https://www.samaa.tv/2087357312-trump-welcomes-xi-jinping-to-us-amid-trade-tensions',
    'https://www.wdbo.com/news/business/trump-xi-jinping/',
    // Syndicated everywhere, located nowhere.
    'https://www.leaderlive.co.uk/news/national/26577160.vistry-cutting-jobs-halving-regional-n',
    'https://www.malverngazette.co.uk/news/national/26577160.vistry-cutting-jobs-halving-region',
    // Categories.
    'https://www.crookwellgazette.com.au/story/9357040/pakistan-hits-afghanistan-sites-after-dr',
    'https://www.goulburnpost.com.au/story/9357040/pakistan-hits-afghanistan-sites-after-drone-',
    'https://www.kccu.org/world/2026-09-23/fears-of-return-to-war-grow-in-ethiopias-tigray-regi',
    'https://www.news4jax.com/business/2026/09/24/senators-to-question-fda-nominee-about-her-vi',
    'https://www.wdbo.com/news/business/senators-question/',
    'https://www.news4jax.com/business/2026/09/24/asian-shares-trade-mixed-as-markets-eye-oil-p',
    'https://www.thepeterboroughexaminer.com/business/asian-shares-trade-mixed-as-markets-eye-o',
    'https://english.news.cn/20260924/b8db66866eec4b24b4b142f84ee4f37e/c.html',
    'https://morningstaronline.co.uk/article/south-sudan-president-dissolves-transitional-gover',
    'https://kansaspublicradio.org/npr-news/2026-09-24/venezuelas-acting-leader-promises-electi',
    'https://www.yumasun.com/news/national_news/as-the-coding-boom-fades-computer-science-grads',
    // A title with HTML entities (&#x2011; is a non-breaking hyphen).
    'https://en.people.cn/n3/2026/0924/c90000-20503366.html',
    // Filters: a stale re-crawl and a digest page.
    'https://www.roadsafety.co.za/2018-04/aarto-to-face-constitutional-challenge/',
    'https://www.yumasun.com/news/national_news/ap-news-summary-at-3-30-a-m-edt/',
  ],
  '20260924081500': [
    'https://www.wdsu.com/article/judge-orders-white-house-to-restore-access-to-news-outlets/',
    'https://punchng.com/us-judge-blocks-white-house-ban-on-cnn-ms-now-politico/',
    'https://kfgo.com/2026/09/24/judge-lifts-trumps-white-house-ban-on-cnn-ms-now-and-politico/',
    'https://www.borehamwoodtimes.co.uk/news/national/26577214.trump-welcomes-chinas-leader-ahe',
    // A title that is only the site's name.
    'https://www.7newsbelize.com/sstory.php?nid=79990',
  ],
  '20260924083000': [
    // The same asiaone URL appears with :443 here and without it at 08:45.
    'https://www.asiaone.com:443/asia/death-toll-capsized-indonesian-ship-climbs-search-widens',
    'https://www.asiaone.com:443/asia/ukraine-sent-two-captured-north-korean-soldiers-south-kor',
    'https://nypost.com/2026/09/24/world-news/ukraine-sent-two-north-korean-soldiers-captured-',
    'https://www.theguardian.com/environment/2026/sep/24/world-warms-up-insects-moving-northwa',
    'https://www.echo-news.co.uk/news/national/26577114.albanese-rebukes-openai-australian-hea',
    'https://www.eastlondonadvertiser.co.uk/news/national/26577114.albanese-rebukes-openai-aus',
  ],
  '20260924084500': [
    'https://www.asiaone.com/asia/death-toll-capsized-indonesian-ship-climbs-search-widens-107',
    'https://www.asiaone.com/asia/ukraine-sent-two-captured-north-korean-soldiers-south-korea-',
    'https://www.aol.co.uk/articles/bumper-bugs-world-warms-insects-080012000.html',
    'https://www.heraldseries.co.uk/news/national/26577114.albanese-rebukes-openai-australian-',
    'https://www.newindianexpress.com/world/2026/Sep/24/nepal-private-airlines-tyre-came-off-d',
    'https://www.vol.at/new-weather-forecast-shows-where-snow-is-now-possible/',
    // No location at all.
    'http://www.rightspeak.net/search/label/U.S.%208th%20Circuit%20Court%20of%20Appeals',
    'https://www.pymnts.com/back-office/next-gen-ap-automation/2026/benefits-payment-exceptions',
  ],
};

/** Keep only the tags the parser reads; PAGE_LINKS alone can run to kilobytes. */
function trimExtras(extras: string): string {
  return ['PAGE_TITLE', 'PAGE_PRECISEPUBTIMESTAMP']
    .map((tag) => {
      const value = extraTag(extras, tag);
      return value === null ? '' : `<${tag}>${value}</${tag}>`;
    })
    .join('');
}

const KEEP = new Set<number>([
  COL.recordId,
  2,
  COL.date,
  COL.domain,
  COL.url,
  COL.themesV2,
  COL.locationsV2,
  COL.persons,
  COL.orgs,
  COL.tone,
  COL.image,
  COL.translation,
]);

function trimRow(fields: string[]): string {
  return fields
    .map((value, i) => (i === COL.extras ? trimExtras(value) : KEEP.has(i) ? value : ''))
    .join('\t');
}

const feed = createFeed(BASE);
const out: string[] = [];
const titles = new Map<string, string>();

for (const [slot, prefixes] of Object.entries(PICKS)) {
  const file = await feed.fetchSlot(slot);
  if (file === null) throw new Error(`slot ${slot} is not available`);
  const rows = file.text.split('\n').map((line) => line.split('\t'));

  for (const prefix of prefixes) {
    const row = rows.find((f) => f.length === GKG_COLUMNS && (f[COL.url] ?? '').startsWith(prefix));
    if (row === undefined) throw new Error(`${slot}: no row starts with ${prefix}`);
    out.push(trimRow(row));
    titles.set(row[COL.url] ?? '', extraTag(row[COL.extras] ?? '', 'PAGE_TITLE') ?? '');
  }
}

writeFileSync(OUT, out.join('\n') + '\n');
console.log(`${OUT}: ${out.length} rows, ${out.join('\n').length} bytes`);
for (const [url, title] of titles)
  console.log(`  ${title.slice(0, 70).padEnd(70)} ${url.slice(0, 60)}`);
