import { describe, expect, it } from 'vitest';

import {
  StoryError,
  StoryGoneError,
  fetchStory,
  locationReportUrl,
  parseStory,
  reportStoryLocation,
  safeHttpUrl,
  storyUrl,
} from './story';

/** As the API serves it: api_story's JSON with the category named. */
function storyJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-000000000007',
    seq: 7,
    title: 'Vote nears in London',
    summary: null,
    category: 'politics',
    heat: 200,
    sentiment: -12,
    source_count: 3,
    published_at: '2026-10-01T09:00:00+00:00',
    first_seen_at: '2026-10-01T09:15:00+00:00',
    place: {
      name: 'London, United Kingdom',
      lat: 51.5,
      lon: -0.12,
      source: 'gdelt',
      confidence: 64,
      country_code: 'GB',
    },
    discussion: { state: 'open', participants: 12 },
    article_count: 2,
    articles: [
      {
        outlet: 'b.example',
        outlet_country: 'GB',
        headline: 'Second write-up',
        url: 'https://b.example/2',
        published_at: '2026-10-01T10:00:00+00:00',
        snippet: null,
      },
      {
        outlet: 'a.example',
        outlet_country: null,
        headline: 'Vote nears in London',
        url: 'https://a.example/1',
        published_at: null,
        snippet: 'A lede.',
      },
    ],
    ...overrides,
  };
}

describe('parseStory', () => {
  it('reads the API story into typed fields', () => {
    const story = parseStory(storyJson());
    expect(story.id).toBe(7);
    expect(story.uuid).toBe('00000000-0000-4000-8000-000000000007');
    expect(story.category).toBe('politics');
    expect(story.publishedAtMs).toBe(Date.UTC(2026, 9, 1, 9));
    expect(story.place).toEqual({
      name: 'London, United Kingdom',
      lat: 51.5,
      lon: -0.12,
      source: 'gdelt',
      confidence: 64,
      countryCode: 'GB',
    });
    expect(story.discussion).toEqual({ state: 'open', participants: 12 });
    expect(story.articles[0]?.publishedAtMs).toBe(Date.UTC(2026, 9, 1, 10));
    expect(story.articles[1]?.publishedAtMs).toBeNull();
    expect(story.articles[1]?.snippet).toBe('A lede.');
  });

  it('drops an article whose link is not http(s), never rendering it', () => {
    const json = storyJson();
    const articles = [
      ...(json['articles'] as unknown[]),
      { outlet: 'x', headline: 'Bad', url: 'javascript:alert(1)', published_at: null },
      { outlet: 'y', headline: 'Relative', url: '/local', published_at: null },
    ];
    const story = parseStory({ ...json, articles });
    expect(story.articles.map((a) => a.headline)).toEqual([
      'Second write-up',
      'Vote nears in London',
    ]);
  });

  it('tolerates unknown names it can degrade, and refuses broken shapes', () => {
    const odd = parseStory(
      storyJson({
        category: 'sport',
        place: { name: null, lat: 0, lon: 0, source: 'psychic', confidence: null },
        discussion: { state: 'none', participants: null },
      }),
    );
    expect(odd.category).toBe('world');
    expect(odd.place.source).toBeNull();
    expect(odd.place.name).toBe('');
    expect(odd.discussion.participants).toBeNull();

    expect(() => parseStory(null)).toThrow(StoryError);
    expect(() => parseStory(storyJson({ seq: 0 }))).toThrow(/seq/);
    expect(() => parseStory(storyJson({ title: 5 }))).toThrow(/title/);
    expect(() => parseStory(storyJson({ published_at: 'yesterday' }))).toThrow(/published_at/);
    expect(() => parseStory(storyJson({ discussion: { state: 'heated' } }))).toThrow(/state/);
    expect(() => parseStory(storyJson({ articles: 'none' }))).toThrow(/articles/);
  });

  it('treats a nonsense participant count as unknown', () => {
    const story = parseStory(storyJson({ discussion: { state: 'open', participants: -3 } }));
    expect(story.discussion.participants).toBeNull();
  });
});

describe('safeHttpUrl', () => {
  it('passes absolute http(s) links and nothing else', () => {
    expect(safeHttpUrl('https://a.example/x?y=1')).toBe('https://a.example/x?y=1');
    expect(safeHttpUrl('HTTP://A.EXAMPLE')).toBe('http://a.example/');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,hi')).toBeNull();
    expect(safeHttpUrl('//a.example')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
  });
});

describe('fetchStory', () => {
  it('asks the API for the story and parses it', async () => {
    const asked: string[] = [];
    const story = await fetchStory({
      baseUrl: '/api/',
      id: 7,
      fetch: async (url) => {
        asked.push(url);
        return new Response(JSON.stringify(storyJson()));
      },
    });
    expect(asked).toEqual(['/api/story/7']);
    expect(story.title).toBe('Vote nears in London');
  });

  it('tells a gone story from a failure', async () => {
    const answer = (status: number) => async (): Promise<Response> =>
      new Response('{}', { status });
    await expect(fetchStory({ baseUrl: '/api', id: 7, fetch: answer(404) })).rejects.toThrow(
      StoryGoneError,
    );
    const failed = fetchStory({ baseUrl: '/api', id: 7, fetch: answer(502) });
    await expect(failed).rejects.toThrow(StoryError);
    await expect(failed).rejects.not.toThrow(StoryGoneError);
    const offline = fetchStory({
      baseUrl: '/api',
      id: 7,
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(offline).rejects.toMatchObject({ status: 0 });
  });

  it('lets an abort through as an abort', async () => {
    const aborted = fetchStory({
      baseUrl: '/api',
      id: 7,
      fetch: async () => {
        throw new DOMException('stopped', 'AbortError');
      },
    });
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('reportStoryLocation', () => {
  it('POSTs once with no body, and reads 404 as gone', async () => {
    const sent: string[] = [];
    const ok = await reportStoryLocation({
      baseUrl: '/api',
      id: 7,
      fetch: async (url, init) => {
        sent.push(`${init?.method} ${url} ${String(init?.body)}`);
        return new Response(null, { status: 204 });
      },
    });
    expect(ok).toBe(true);
    expect(sent).toEqual(['POST /api/story/7/location-report undefined']);
    const gone = await reportStoryLocation({
      baseUrl: '/api',
      id: 8,
      fetch: async () => new Response('{}', { status: 404 }),
    });
    expect(gone).toBe(false);
    await expect(
      reportStoryLocation({
        baseUrl: '/api',
        id: 7,
        fetch: async () => new Response('{}', { status: 503 }),
      }),
    ).rejects.toThrow(StoryError);
  });

  it('builds the URLs from the configured base', () => {
    expect(storyUrl('https://x.example/api//', 3)).toBe('https://x.example/api/story/3');
    expect(locationReportUrl('/api', 3)).toBe('/api/story/3/location-report');
  });
});
