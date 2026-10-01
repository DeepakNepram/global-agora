import { describe, expect, it } from 'vitest';

import {
  decodePermalink,
  encodePermalink,
  formatLinkTime,
  isEmptyPermalink,
  parseLinkTime,
  withoutPermalink,
  type Permalink,
} from './permalink';

const BASE = 'https://agora.example/';
const AT = Date.UTC(2026, 9, 1, 12, 34, 56);
const LINK: Permalink = {
  story: 23904,
  camera: { lat: 51.50735, lon: -0.12776, altitudeKm: 1200.4 },
  timeMs: AT,
};

function query(url: string): string {
  return new URL(url).search;
}

describe('encodePermalink', () => {
  it('writes a short, legible link', () => {
    expect(encodePermalink(BASE, LINK)).toBe(
      'https://agora.example/?story=23904&cam=51.5074,-0.1278,1200&t=20261001T123456Z',
    );
  });

  it('round-trips at the precision it promises', () => {
    const decoded = decodePermalink(query(encodePermalink(BASE, LINK)));
    expect(decoded.story).toBe(23904);
    expect(decoded.timeMs).toBe(AT);
    expect(decoded.camera?.lat).toBeCloseTo(51.50735, 4);
    expect(decoded.camera?.lon).toBeCloseTo(-0.12776, 4);
    expect(decoded.camera?.altitudeKm).toBe(1200);
  });

  it('keeps a decimal of altitude close in, where a kilometre shows', () => {
    const close = { ...LINK, camera: { lat: 0, lon: 0, altitudeKm: 52.37 } };
    expect(encodePermalink(BASE, close)).toContain('cam=0,0,52.4&');
  });

  it('wraps longitude, clamps latitude and never writes a negative zero', () => {
    const odd = { ...LINK, camera: { lat: 91, lon: 190, altitudeKm: 500 } };
    expect(encodePermalink(BASE, odd)).toContain('cam=90,-170,500&');
    const tiny = { ...LINK, camera: { lat: -0.00001, lon: -0.00001, altitudeKm: 500 } };
    expect(encodePermalink(BASE, tiny)).toContain('cam=0,0,500&');
  });

  it('rounds the time to the second', () => {
    const link = { ...LINK, timeMs: AT + 600 };
    expect(decodePermalink(query(encodePermalink(BASE, link))).timeMs).toBe(AT + 1000);
  });

  it('replaces any query or fragment on the base and leaves out null fields', () => {
    const url = encodePermalink('https://agora.example/app/?x=1#top', {
      story: 7,
      camera: null,
      timeMs: null,
    });
    expect(url).toBe('https://agora.example/app/?story=7');
    expect(encodePermalink(BASE, { story: null, camera: null, timeMs: null })).toBe(BASE);
  });
});

describe('decodePermalink', () => {
  it('reads a query with or without its question mark, and escaped commas', () => {
    const plain = decodePermalink('story=5&cam=10,20,300&t=20261001T000000Z');
    expect(plain).toEqual({
      story: 5,
      camera: { lat: 10, lon: 20, altitudeKm: 300 },
      timeMs: Date.UTC(2026, 9, 1),
    });
    expect(decodePermalink('?story=5&cam=10%2C20%2C300&t=20261001T000000Z')).toEqual(plain);
  });

  it('is empty without its fields', () => {
    const link = decodePermalink('?utm_source=x');
    expect(link).toEqual({ story: null, camera: null, timeMs: null });
    expect(isEmptyPermalink(link)).toBe(true);
    expect(isEmptyPermalink(decodePermalink('?story=1'))).toBe(false);
  });

  it.each([
    ['story=abc', 'a word'],
    ['story=0', 'zero'],
    ['story=-3', 'a negative'],
    ['story=1.5', 'a fraction'],
    ['story=4294967296', 'past Uint32'],
    ['story=007', 'leading zeros'],
  ])('drops a bad story id (%s: %s) and keeps the rest', (story) => {
    const link = decodePermalink(`?${story}&cam=1,2,300&t=20261001T000000Z`);
    expect(link.story).toBeNull();
    expect(link.camera).not.toBeNull();
    expect(link.timeMs).not.toBeNull();
  });

  it.each([
    ['91,0,300', 'latitude past the pole'],
    ['0,181,300', 'longitude past the antimeridian'],
    ['0,0,0', 'zero altitude'],
    ['0,0,-5', 'negative altitude'],
    ['0,0,1000000', 'absurd altitude'],
    ['1,2', 'two numbers'],
    ['1,2,3,4', 'four numbers'],
    ['a,b,c', 'words'],
    ['1e2,0,300', 'exponent notation'],
    ['NaN,0,300', 'NaN'],
  ])('drops a bad camera (%s: %s) and keeps the rest', (cam) => {
    const link = decodePermalink(`?story=9&cam=${cam}&t=20261001T000000Z`);
    expect(link.camera).toBeNull();
    expect(link.story).toBe(9);
    expect(link.timeMs).not.toBeNull();
  });

  it.each([
    ['2026-10-01T00:00:00Z', 'extended ISO'],
    ['20261001T000000', 'no zone'],
    ['20261301T000000Z', 'month 13'],
    ['20260230T000000Z', '30 February'],
    ['20261001T250000Z', 'hour 25'],
    ['20261001T006000Z', 'minute 60'],
    ['1790243100', 'epoch seconds'],
  ])('drops a bad time (%s: %s) and keeps the rest', (t) => {
    const link = decodePermalink(`?story=9&cam=1,2,300&t=${t}`);
    expect(link.timeMs).toBeNull();
    expect(link.story).toBe(9);
    expect(link.camera).not.toBeNull();
  });
});

describe('link times', () => {
  it('round-trips across a leap day and the year end', () => {
    for (const ms of [Date.UTC(2028, 1, 29, 23, 59, 59), Date.UTC(2026, 11, 31, 23, 0, 1)]) {
      expect(parseLinkTime(formatLinkTime(ms))).toBe(ms);
    }
    expect(formatLinkTime(Date.UTC(2028, 1, 29, 7, 5, 3))).toBe('20280229T070503Z');
  });
});

describe('withoutPermalink', () => {
  it('removes only the permalink fields', () => {
    expect(withoutPermalink('?story=1&cam=1,2,3&t=20261001T000000Z')).toBe('');
    expect(withoutPermalink('?cat=health&story=1')).toBe('?cat=health');
    expect(withoutPermalink('')).toBe('');
  });
});
