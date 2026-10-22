import { describe, expect, it } from 'vitest';

import { AdminError } from '../admin';
import {
  adminErrorCode,
  createAdminConsoleRemote,
  toCounters,
  toHotStory,
  toSuggestion,
} from './admin';
import type { DbClient } from './client';

describe('adminErrorCode', () => {
  it('names what the database refused', () => {
    expect(adminErrorCode({ code: '42501', message: 'moderators only' })).toBe('not-admin');
    expect(adminErrorCode({ code: 'PT409', message: '25 discussions are open' })).toBe('cap');
    expect(adminErrorCode({ code: '55000', message: 'not in the queue' })).toBe('not-queued');
    expect(adminErrorCode({ code: 'P0002', message: 'no such story' })).toBe('missing');
    expect(adminErrorCode({ code: '22023', message: 'too long' })).toBe('invalid');
    expect(adminErrorCode({ code: 'PGRST303', message: 'JWT expired' })).toBe('signed-out');
    expect(adminErrorCode({ message: 'TypeError: Failed to fetch' })).toBe('network');
    expect(adminErrorCode({ code: 'XX000', message: 'boom' })).toBe('unknown');
  });
});

describe('rows', () => {
  it('reads a hot story', () => {
    expect(
      toHotStory({
        story_id: 's1',
        seq: 42,
        title: 'Hot',
        summary: null,
        place_name: 'Paris',
        country_code: 'FR',
        heat: 200,
        source_count: 9,
        published_at: '2026-10-22T06:00:00Z',
        location_reports: 2,
      }),
    ).toEqual({
      storyId: 's1',
      seq: 42,
      title: 'Hot',
      summary: null,
      placeName: 'Paris',
      countryCode: 'FR',
      heat: 200,
      sourceCount: 9,
      publishedAtMs: Date.parse('2026-10-22T06:00:00Z'),
      locationReports: 2,
    });
  });

  it('reads the counters, with no median and nothing open', () => {
    expect(
      toCounters({
        open_discussions: 0,
        max_open: 25,
        next_close_at: null,
        posts_today: 0,
        reports_open: 0,
        median_action_seconds: null,
        reports_resolved: 0,
        median_window_days: 7,
      }),
    ).toMatchObject({ nextCloseAtMs: null, medianActionSeconds: null, maxOpen: 25 });
  });

  it('reads a suggestion, or why there is none', () => {
    expect(
      toSuggestion({ suggestion: { prompt: 'Q?', side_a: 'Y', side_b: 'N' }, reason: 'ok' }),
    ).toEqual({
      kind: 'ok',
      draft: { prompt: 'Q?', sideA: 'Y', sideB: 'N' },
    });
    expect(toSuggestion({ suggestion: null, reason: 'declined' })).toEqual({
      kind: 'none',
      reason: 'declined',
    });
    expect(toSuggestion('junk')).toEqual({ kind: 'none', reason: 'unavailable' });
  });
});

/** Just enough of the client: rpc() and functions.invoke(), answering as told. */
function fakeClient(answers: {
  rpc?: { data: unknown; error: unknown };
  invoke?: { data: unknown; error: unknown };
}) {
  const calls: { name: string; args: unknown }[] = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return answers.rpc ?? { data: null, error: null };
    },
    functions: {
      invoke: async (name: string, options: unknown) => {
        calls.push({ name, args: options });
        return answers.invoke ?? { data: null, error: null };
      },
    },
  } as unknown as DbClient;
  return { client, calls };
}

describe('createAdminConsoleRemote', () => {
  it('reports the cap with when the next discussion closes', async () => {
    const { client } = fakeClient({
      rpc: {
        data: null,
        error: {
          code: 'PT409',
          message: '25 discussions are open, the most at once.',
          details: '2026-10-22 14:20:00+00',
        },
      },
    });
    const error = await createAdminConsoleRemote(client)
      .openDiscussion('s1', { prompt: 'Q?', sideA: 'Y', sideB: 'N' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdminError);
    expect(error).toMatchObject({ code: 'cap', nextCloseAtMs: Date.parse('2026-10-22T14:20:00Z') });
  });

  it('sends the counters the admin’s midnight', async () => {
    const { client, calls } = fakeClient({
      rpc: {
        data: [
          {
            open_discussions: 3,
            max_open: 25,
            next_close_at: '2026-10-22T14:20:00Z',
            posts_today: 12,
            reports_open: 2,
            median_action_seconds: 120,
            reports_resolved: 3,
            median_window_days: 7,
          },
        ],
        error: null,
      },
    });
    const counters = await createAdminConsoleRemote(client).counters(Date.UTC(2026, 9, 21, 18, 30));
    expect(calls[0]).toEqual({
      name: 'admin_counters',
      args: { p_day_start: '2026-10-21T18:30:00.000Z' },
    });
    expect(counters.openDiscussions).toBe(3);
  });

  it('asks the suggest-debate function, and reads its refusals', async () => {
    const ok = fakeClient({
      invoke: { data: { suggestion: null, reason: 'not-configured' }, error: null },
    });
    expect(await createAdminConsoleRemote(ok.client).suggest('s1')).toEqual({
      kind: 'none',
      reason: 'not-configured',
    });
    expect(ok.calls[0]).toEqual({ name: 'suggest-debate', args: { body: { story_id: 's1' } } });

    const refused = fakeClient({
      invoke: { data: null, error: { context: new Response('{}', { status: 403 }) } },
    });
    await expect(createAdminConsoleRemote(refused.client).suggest('s1')).rejects.toMatchObject({
      code: 'not-admin',
    });
    const down = fakeClient({
      invoke: { data: null, error: { context: new Response('{}', { status: 503 }) } },
    });
    expect(await createAdminConsoleRemote(down.client).suggest('s1')).toEqual({
      kind: 'none',
      reason: 'unavailable',
    });
  });

  it('sends no place as an empty string, which the database reads as none', async () => {
    const { client, calls } = fakeClient({ rpc: { data: 4, error: null } });
    expect(
      await createAdminConsoleRemote(client).fixLocation('s1', {
        lat: 12.97,
        lon: 77.59,
        placeName: null,
        countryCode: null,
      }),
    ).toBe(4);
    expect(calls[0]?.args).toEqual({
      p_story: 's1',
      p_lat: 12.97,
      p_lon: 77.59,
      p_place_name: '',
      p_country_code: '',
    });
  });
});
