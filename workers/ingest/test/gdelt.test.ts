import { describe, expect, it, vi } from 'vitest';

import { createFeed, gkgUrl, parseManifest, type Fetch } from '../src/gdelt/feed.ts';
import { GKG_COLUMNS, parseGkg } from '../src/gdelt/gkg.ts';
import {
  formatGdeltTime,
  isSlot,
  nextSlot,
  parseGdeltTime,
  previousSlot,
  slotAt,
  slotFromIso,
  slotIso,
} from '../src/gdelt/slots.ts';
import { readSingleEntry, unzipText, ZipError } from '../src/gdelt/zip.ts';

import { FIXTURE_TEXT, fixtureRecord, makeZip } from './helpers.ts';

describe('slots', () => {
  it('parses and formats GDELT timestamps in UTC', () => {
    expect(parseGdeltTime('20260924084500')).toBe(Date.UTC(2026, 8, 24, 8, 45) / 1000);
    expect(formatGdeltTime(Date.UTC(2026, 8, 24, 8, 45) / 1000)).toBe('20260924084500');
  });

  it('rejects impossible or malformed timestamps', () => {
    expect(parseGdeltTime('20260231120000')).toBeNull();
    expect(parseGdeltTime('2026092408450')).toBeNull();
    expect(parseGdeltTime('2026-09-24T08')).toBeNull();
  });

  it('knows slots are quarter hours', () => {
    expect(isSlot('20260924084500')).toBe(true);
    expect(isSlot('20260924084000')).toBe(false);
    expect(slotAt(Date.UTC(2026, 8, 24, 8, 59, 59) / 1000)).toBe('20260924084500');
  });

  it('steps across midnight', () => {
    expect(nextSlot('20260924234500')).toBe('20260925000000');
    expect(previousSlot('20260925000000')).toBe('20260924234500');
  });

  it('round-trips through the database timestamp', () => {
    expect(slotIso('20260924084500')).toBe('2026-09-24T08:45:00.000Z');
    expect(slotFromIso('2026-09-24T08:45:00+00:00')).toBe('20260924084500');
  });
});

describe('zip', () => {
  it('inflates a deflated entry', async () => {
    const zip = makeZip('20260924084500.gkg.csv', 'a\tb\nc\td\n');
    expect(readSingleEntry(zip).name).toBe('20260924084500.gkg.csv');
    await expect(unzipText(zip)).resolves.toBe('a\tb\nc\td\n');
  });

  it('reads a stored entry', async () => {
    await expect(unzipText(makeZip('x.csv', 'plain', 0))).resolves.toBe('plain');
  });

  it('keeps UTF-8 intact', async () => {
    await expect(unzipText(makeZip('x.csv', 'Côte d’Ivoire — 東京'))).resolves.toBe(
      'Côte d’Ivoire — 東京',
    );
  });

  it('refuses what is not a single-entry zip', () => {
    expect(() => readSingleEntry(new TextEncoder().encode('<html>404</html>'))).toThrow(ZipError);
    const two = makeZip('x.csv', 'x');
    new DataView(two.buffer).setUint16(two.byteLength - 12, 2, true);
    expect(() => readSingleEntry(two)).toThrow(/one entry/);
  });
});

describe('GKG parser (real rows)', () => {
  it('parses every fixture row, all 27 columns', () => {
    const { records, malformed } = parseGkg(FIXTURE_TEXT);
    expect(malformed).toBe(0);
    expect(records).toHaveLength(57);
    expect(FIXTURE_TEXT.split('\n')[0]?.split('\t')).toHaveLength(GKG_COLUMNS);
  });

  it('reads the fields the pipeline uses', () => {
    const r = fixtureRecord('https://www.kccu.org/business/2026-09-24/judge-orders');
    expect(r.seenAt).toBe(Date.UTC(2026, 8, 24, 8, 0) / 1000);
    expect(r.domain).toBe('kccu.org');
    expect(r.title).toBe(
      "Judge orders Trump administration to restore journalists' access to White House",
    );
    expect(r.persons).toContain('timothy kelly');
    expect(r.orgs).toContain('white house');
    expect(r.locations.length).toBeGreaterThan(0);
    const whiteHouse = r.locations.find((l) => l.name.startsWith('White House'));
    expect(whiteHouse).toMatchObject({ type: 3, fips: 'US' });
    expect(whiteHouse?.lat).toBeCloseTo(38.9, 1);
    expect(r.themes.size).toBeGreaterThan(5);
    expect(r.tone).not.toBeNull();
    expect(r.translated).toBe(false);
  });

  it('counts theme mentions from the enhanced (offset) column', () => {
    const r = fixtureRecord('https://www.crookwellgazette.com.au/story/9357040');
    expect(Math.max(...r.themes.values())).toBeGreaterThan(1);
  });

  it('reads the precise publish time when GDELT has one, and null when not', () => {
    expect(fixtureRecord('https://www.newsitem.com/').publishedAt).not.toBeNull();
    expect(fixtureRecord('https://www.kccu.org/business/').publishedAt).toBeNull();
  });

  it('keeps HTML entities for the title normalizer to decode', () => {
    const titles = parseGkg(FIXTURE_TEXT).records.map((r) => r.title ?? '');
    expect(titles.some((t) => /&#x[0-9A-F]+;|&amp;/i.test(t))).toBe(true);
  });

  it('counts malformed rows instead of throwing', () => {
    const good = FIXTURE_TEXT.split('\n')[0] ?? '';
    const { records, malformed } = parseGkg(`${good}\nshort\trow\n\n${good}\r\n`);
    expect(records).toHaveLength(2);
    expect(malformed).toBe(1);
  });

  it('drops locations with missing coordinates rather than placing them at 0,0', () => {
    const fields = (FIXTURE_TEXT.split('\n')[0] ?? '').split('\t');
    fields[10] =
      '4#Nowhere, Somewhere#XX#XX00##-##X#1;4#Suva, Fiji#FJ#FJ01##-18.1333#178.417#-2372#5';
    const [record] = parseGkg(fields.join('\t')).records;
    expect(record?.locations.map((l) => l.name)).toEqual(['Suva, Fiji']);
  });
});

describe('feed', () => {
  const manifest =
    '82306 d634 http://data.gdeltproject.org/gdeltv2/20260924094500.export.CSV.zip\n' +
    '105535 264b http://data.gdeltproject.org/gdeltv2/20260924094500.mentions.CSV.zip\n' +
    '4609912 3b8e http://data.gdeltproject.org/gdeltv2/20260924094500.gkg.csv.zip\n';

  it('reads the GKG slot from the real manifest format', () => {
    expect(parseManifest(manifest)).toBe('20260924094500');
    expect(parseManifest('nothing here')).toBeNull();
  });

  it('builds file URLs from the base', () => {
    expect(gkgUrl('https://data.gdeltproject.org/gdeltv2/', '20260924084500')).toBe(
      'https://data.gdeltproject.org/gdeltv2/20260924084500.gkg.csv.zip',
    );
  });

  it('treats 404 as not published yet, and other failures as errors', async () => {
    const zip = makeZip('20260924084500.gkg.csv', 'row\n');
    const fetchFn = vi.fn<Fetch>(async (url) => {
      if (url.endsWith('lastupdate.txt')) return new Response(manifest);
      if (url.includes('20260924084500')) return new Response(zip);
      if (url.includes('20260924090000')) return new Response('down', { status: 503 });
      return new Response('missing', { status: 404 });
    });
    const feed = createFeed('https://gdelt.example/v2', fetchFn);

    await expect(feed.latestListedSlot()).resolves.toBe('20260924094500');
    await expect(feed.fetchSlot('20260924084500')).resolves.toEqual({
      text: 'row\n',
      bytes: zip.byteLength,
    });
    await expect(feed.fetchSlot('20260924094500')).resolves.toBeNull();
    await expect(feed.hasSlot('20260924094500')).resolves.toBe(false);
    await expect(feed.fetchSlot('20260924090000')).rejects.toThrow(/503/);
  });
});
