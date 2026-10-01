import { describe, expect, it } from 'vitest';

import {
  fetchOutlets,
  fetchOutletStories,
  outletStoriesUrl,
  parseOutletsIndex,
  parseOutletStories,
  isOutletName,
  OutletsError,
} from './outlets';

const INDEX = {
  v: 1,
  generated_at: 1_790_000_000,
  window_hours: 24,
  outlets: ['wire.example', 'daily.example'],
  n: [12, 3],
};

describe('parseOutletsIndex', () => {
  it('accepts a well-formed index as is', () => {
    expect(parseOutletsIndex(INDEX)).toBe(INDEX);
  });

  it.each([
    [{ ...INDEX, v: 2 }, /version 1/],
    [{ ...INDEX, outlets: ['a', 7] }, /names/],
    [{ ...INDEX, n: [12] }, /count per outlet/],
    [{ ...INDEX, n: [12, 0] }, /count per outlet/],
    [{ ...INDEX, window_hours: 0 }, /window_hours/],
  ])('refuses %j', (value, message) => {
    expect(() => parseOutletsIndex(value)).toThrow(message);
  });
});

describe('parseOutletStories', () => {
  it('reads an outlet and its ids', () => {
    expect(parseOutletStories({ outlet: 'wire.example', ids: [3, 1] })).toEqual({
      outlet: 'wire.example',
      ids: [3, 1],
    });
  });

  it('refuses ids that are not payload ids', () => {
    expect(() => parseOutletStories({ outlet: 'x', ids: [0] })).toThrow(OutletsError);
    expect(() => parseOutletStories({ outlet: 'x', ids: ['1'] })).toThrow(OutletsError);
    expect(() => parseOutletStories({ ids: [] })).toThrow(OutletsError);
  });
});

describe('fetching', () => {
  it('asks the API for the index and for one outlet', async () => {
    const urls: string[] = [];
    const fetch = async (url: string): Promise<Response> => {
      urls.push(url);
      return new Response(
        JSON.stringify(url.includes('/outlets/') ? { outlet: 'a.example', ids: [1] } : INDEX),
      );
    };
    await fetchOutlets('/api', 24, { fetch });
    await fetchOutletStories('/api', 'a.example', 24, { fetch });
    expect(urls).toEqual(['/api/outlets?hours=24', '/api/outlets/a.example?hours=24']);
  });

  it('escapes an outlet in the path', () => {
    expect(outletStoriesUrl('/api', 'a b/c', 6)).toBe('/api/outlets/a%20b%2Fc?hours=6');
  });

  it('fails on an HTTP error', async () => {
    await expect(
      fetchOutlets('/api', 24, { fetch: async () => new Response('', { status: 502 }) }),
    ).rejects.toThrow(/HTTP 502/);
  });
});

describe('isOutletName', () => {
  it("takes domains and names, within the column's length", () => {
    expect(isOutletName('bbc.co.uk')).toBe(true);
    expect(isOutletName('Tasman Record')).toBe(true);
    expect(isOutletName('x'.repeat(120))).toBe(true);
    expect(isOutletName('x'.repeat(121))).toBe(false);
    expect(isOutletName('')).toBe(false);
    expect(isOutletName('a\nb')).toBe(false);
  });
});
