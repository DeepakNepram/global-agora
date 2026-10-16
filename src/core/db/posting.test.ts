import { describe, expect, it } from 'vitest';

import type { DbClient } from './client';
import { createPostingRemote } from './posting';

const ROW = {
  id: 'p1',
  story_id: 's1',
  body: 'b',
  stance: 'a',
  kind: 'argument',
  evidence_url: null,
  region_label: null,
  mod_state: 'pending',
  created_at: '2026-10-18T09:00:00Z',
};

function client(session: { access_token: string } | null): DbClient {
  return {
    auth: { getSession: async () => ({ data: { session }, error: null }) },
  } as unknown as DbClient;
}

describe('createPostingRemote', () => {
  it("posts with the session's access token", async () => {
    let authorization = '';
    const remote = createPostingRemote(client({ access_token: 'jwt-1' }), {
      apiBaseUrl: '/api',
      fetch: async (_url, init) => {
        authorization = (init?.headers as Record<string, string>)['authorization'] ?? '';
        return new Response(JSON.stringify(ROW), { status: 201 });
      },
    });
    const post = await remote.submit({
      storyId: 's1',
      body: 'b',
      kind: 'argument',
      evidenceUrl: null,
      localBadge: false,
    });
    expect(authorization).toBe('Bearer jwt-1');
    expect(post.id).toBe('p1');
  });

  it('refuses without a session, before calling the Worker', async () => {
    let called = false;
    const remote = createPostingRemote(client(null), {
      apiBaseUrl: '/api',
      fetch: async () => {
        called = true;
        return new Response('{}');
      },
    });
    await expect(
      remote.submit({
        storyId: 's1',
        body: 'b',
        kind: 'argument',
        evidenceUrl: null,
        localBadge: true,
      }),
    ).rejects.toMatchObject({ code: 'signed-out' });
    expect(called).toBe(false);
  });
});
