import { describe, expect, it } from 'vitest';

import { countryName, parseLocalBadgeReply, REGION_LABEL_MAX, regionLabel } from './localBadge';

/** The database's CHECK on posts.region_label (…_local_badge.sql), in JS. */
const SHAPE = /^[^\p{Cc}]+ area(, [^\p{Cc}]+)?$/u;

describe('regionLabel', () => {
  it('names the city as an area, with its country', () => {
    expect(regionLabel({ city: 'Bengaluru', country: 'IN' })).toBe('Bengaluru area, India');
    expect(regionLabel({ city: 'Paris', country: 'us' })).toBe('Paris area, United States');
  });

  it('keeps a city name outside ASCII as it is', () => {
    expect(regionLabel({ city: 'São Paulo', country: 'BR' })).toBe('São Paulo area, Brazil');
    expect(regionLabel({ city: 'Zürich', country: 'CH' })).toBe('Zürich area, Switzerland');
  });

  it('shows the city alone when the country is unknown, Tor, or not a country', () => {
    for (const country of [null, '', 'XX', 'T1', 'EU', 'UN', 'ZZ', 'XA', 'QO', 'India']) {
      expect(regionLabel({ city: 'Bengaluru', country })).toBe('Bengaluru area');
    }
  });

  it('has no label without a city, whatever the country', () => {
    for (const city of [null, '', '   ', '\u0000']) {
      expect(regionLabel({ city, country: 'IN' })).toBeNull();
    }
  });

  it('shortens the awkward standard names', () => {
    expect(countryName('HK')).toBe('Hong Kong');
    expect(countryName('CD')).toBe('DR Congo');
    expect(countryName('MM')).toBe('Myanmar');
  });

  it('makes one clean line of whatever Cloudflare sends', () => {
    expect(regionLabel({ city: '  New\tYork \n', country: 'US' })).toBe(
      'New York area, United States',
    );
    expect(regionLabel({ city: 'Cairo\u202E', country: 'EG' })).toBe('Cairo area, Egypt');
    // NFC: a decomposed "é" becomes one code point, as Postgres would count it.
    expect(regionLabel({ city: 'Mont-Ste-Anne\u0301', country: null })).toBe('Mont-Ste-Anné area');
  });

  it('drops the country before going over the limit, and gives up past it', () => {
    const long = 'L'.repeat(REGION_LABEL_MAX - ' area'.length);
    expect(regionLabel({ city: long, country: 'IN' })).toBe(`${long} area`);
    expect(regionLabel({ city: `${long}L`, country: 'IN' })).toBeNull();
  });

  it('never yields anything shaped like a coordinate', () => {
    expect(regionLabel({ city: '12.97', country: 'IN' })).toBeNull();
    expect(regionLabel({ city: '77,59', country: null })).toBeNull();
  });

  it('only ever yields what the database accepts', () => {
    const cities = ['Bengaluru', 'São Paulo', "Xi'an", 'Washington, D.C.', '6th of October City'];
    for (const city of cities) {
      for (const country of ['IN', 'US', null, 'T1']) {
        const label = regionLabel({ city, country });
        expect(label).not.toBeNull();
        expect(label).toMatch(SHAPE);
        expect([...(label ?? '')].length).toBeLessThanOrEqual(REGION_LABEL_MAX);
      }
    }
  });
});

describe('parseLocalBadgeReply', () => {
  it('reads a label, or the reason there is none', () => {
    expect(parseLocalBadgeReply({ label: 'Bengaluru area, India' })).toEqual({
      label: 'Bengaluru area, India',
    });
    expect(parseLocalBadgeReply({ label: null, reason: 'no-city' })).toEqual({
      label: null,
      reason: 'no-city',
    });
  });

  it('rejects anything else', () => {
    for (const value of [null, 'x', {}, { label: '' }, { label: 4 }, { label: null }]) {
      expect(parseLocalBadgeReply(value)).toBeNull();
    }
  });
});
