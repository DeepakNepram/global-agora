import { describe, expect, it } from 'vitest';

import {
  fetchLocalBadge,
  parseSubmittedPost,
  PostingError,
  postingErrorFrom,
  submitPost,
  type PostDraft,
} from './posting';

const DRAFT: PostDraft = {
  storyId: 's1',
  body: 'The port should reopen.',
  kind: 'argument',
  evidenceUrl: null,
  localBadge: true,
};

const ROW = {
  id: 'p1',
  story_id: 's1',
  body: 'The port should reopen.',
  stance: 'a',
  kind: 'argument',
  evidence_url: null,
  region_label: 'Bengaluru area, India',
  mod_state: 'pending',
  created_at: '2026-10-18T09:00:00+00:00',
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('submitPost', () => {
  it('sends the draft with the reader token and the badge choice, and reads the post back', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const post = await submitPost({
      apiBaseUrl: '/api/',
      token: 'reader-token',
      draft: DRAFT,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return reply(201, ROW);
      },
    });
    expect(calls[0]?.url).toBe('/api/posts');
    expect(calls[0]?.init?.method).toBe('POST');
    expect((calls[0]?.init?.headers as Record<string, string>)['authorization']).toBe(
      'Bearer reader-token',
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      story_id: 's1',
      body: 'The port should reopen.',
      kind: 'argument',
      evidence_url: null,
      local_badge: true,
    });
    expect(post).toMatchObject({
      id: 'p1',
      regionLabel: 'Bengaluru area, India',
      modState: 'pending',
      badgeDropped: false,
      createdAtMs: Date.UTC(2026, 9, 18, 9),
    });
  });

  it('never sends a label of its own: the Worker makes it', async () => {
    let sent = '';
    await submitPost({
      apiBaseUrl: '/api',
      token: 't',
      draft: DRAFT,
      fetch: async (_url, init) => {
        sent = String(init?.body);
        return reply(201, ROW);
      },
    });
    expect(sent).not.toContain('region');
    expect(sent).not.toContain('Bengaluru');
  });

  it('says when the badge was asked for but the network had no city', () => {
    const noLabel = { ...ROW, region_label: null };
    expect(parseSubmittedPost(noLabel, true).badgeDropped).toBe(true);
    expect(parseSubmittedPost(noLabel, false).badgeDropped).toBe(false);
  });

  it('turns the posting limits into a wait', async () => {
    const error = await submitPost({
      apiBaseUrl: '/api',
      token: 't',
      draft: DRAFT,
      fetch: async () =>
        reply(429, {
          code: 'PT429',
          details: '{"retry_after_seconds":23.4,"limit":"spacing"}',
          message: 'Posting too fast',
        }),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PostingError);
    expect(error).toMatchObject({ code: 'rate-limited', retryAfterSeconds: 24 });
  });

  it('turns a dropped connection into a network error', async () => {
    const error = await submitPost({
      apiBaseUrl: '/api',
      token: 't',
      draft: DRAFT,
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'network' });
  });
});

describe('postingErrorFrom', () => {
  it('maps each refusal to something the composer can explain', () => {
    expect(postingErrorFrom(401, { error: 'sign in to post' }).code).toBe('signed-out');
    expect(postingErrorFrom(403, { code: '42501', message: 'closed' }).code).toBe('not-allowed');
    expect(postingErrorFrom(400, { code: '23514' }).code).toBe('invalid');
    expect(postingErrorFrom(413, null).code).toBe('invalid');
    expect(postingErrorFrom(503, { error: 'API not configured' }).code).toBe('unavailable');
    expect(postingErrorFrom(500, null).code).toBe('unknown');
    expect(postingErrorFrom(429, { code: 'PT429' }).retryAfterSeconds).toBe(60);
  });
});

describe('parseSubmittedPost', () => {
  it('refuses a reply that is not a post', () => {
    for (const bad of [null, {}, { ...ROW, kind: 'rant' }, { ...ROW, created_at: 'soon' }]) {
      expect(() => parseSubmittedPost(bad, false)).toThrow(PostingError);
    }
  });
});

describe('fetchLocalBadge', () => {
  it('asks the Worker, uncached, and reads the label or the reason', async () => {
    let init: RequestInit | undefined;
    const found = await fetchLocalBadge('/api', async (_url, i) => {
      init = i;
      return reply(200, { label: 'Bengaluru area, India' });
    });
    expect(found).toEqual({ label: 'Bengaluru area, India' });
    expect(init?.cache).toBe('no-store');
    expect(
      await fetchLocalBadge('/api', async () => reply(200, { label: null, reason: 'no-city' })),
    ).toEqual({ label: null, reason: 'no-city' });
  });

  it('fails clearly when the Worker cannot be asked', async () => {
    await expect(fetchLocalBadge('/api', async () => reply(502, {}))).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(
      fetchLocalBadge('/api', async () => reply(200, { what: 1 })),
    ).rejects.toMatchObject({ code: 'unknown' });
  });
});
