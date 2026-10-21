/**
 * Discussions over Supabase (Prompt 4.5): the debate, its posts and the room's
 * balance as the reader may see them (RLS decides, blocks both ways
 * included), the reader's side and votes, and the live feed.
 *
 * The feed is a public broadcast of post ids (private.posts_broadcast). An id
 * is read back here under RLS before anything shows it, so a broadcast never
 * shows a post a block or moderation hides.
 */

// Explicit .ts: scripts/db/smoke.ts loads this under plain Node, which needs it.
import {
  DiscussionError,
  discussionTopic,
  type DiscussionErrorCode,
  type DiscussionInfo,
  type DiscussionPost,
  type DiscussionRemote,
  type RoomBalance,
} from '../discussion.ts';
import { POST_KINDS, type PostKind, type PostModState, type PostStance } from '../posting.ts';
import type { DbClient } from './client';

/** Every post column a reader may read (not mod_scores), and the author's handle. */
export const POST_COLUMNS =
  'id, author_id, body, stance, kind, evidence_url, region_label, mod_state, helpful_count, ' +
  'cross_side_count, changed_mind_count, rank_score, created_at, ' +
  'author:profiles!posts_author_id_fkey(handle)';

export interface PostRow {
  readonly id: string;
  readonly author_id: string;
  readonly body: string;
  readonly stance: string;
  readonly kind: string;
  readonly evidence_url: string | null;
  readonly region_label: string | null;
  readonly mod_state: string;
  readonly helpful_count: number;
  readonly cross_side_count: number;
  readonly changed_mind_count: number;
  readonly rank_score: number;
  readonly created_at: string;
  readonly author: { readonly handle: string } | null;
}

const STANCES: ReadonlySet<string> = new Set(['a', 'b', 'neutral']);
const KINDS: ReadonlySet<string> = new Set(POST_KINDS);
const STATES: ReadonlySet<string> = new Set(['pending', 'ok', 'hidden', 'removed']);

/** A row as a post; null for one with a value this build does not know. */
export function toDiscussionPost(row: PostRow): DiscussionPost | null {
  const createdAtMs = Date.parse(row.created_at);
  if (!STANCES.has(row.stance) || !KINDS.has(row.kind) || !STATES.has(row.mod_state)) return null;
  if (!Number.isFinite(createdAtMs)) return null;
  return {
    id: row.id,
    authorId: row.author_id,
    authorHandle: row.author?.handle ?? null,
    body: row.body,
    stance: row.stance as PostStance,
    kind: row.kind as PostKind,
    evidenceUrl: row.evidence_url,
    regionLabel: row.region_label,
    modState: row.mod_state as PostModState,
    helpfulCount: row.helpful_count,
    crossSideCount: row.cross_side_count,
    changedMindCount: row.changed_mind_count,
    rankScore: row.rank_score,
    createdAtMs,
  };
}

function posts(rows: readonly PostRow[] | null): DiscussionPost[] {
  return (rows ?? []).map(toDiscussionPost).filter((post): post is DiscussionPost => post !== null);
}

interface ServerError {
  readonly message: string;
  readonly code?: string | undefined;
}

export function discussionErrorCode(error: ServerError): DiscussionErrorCode {
  const code = error.code ?? '';
  // RLS refusing a write: no side, rules not agreed, suspended, closed, locked.
  if (code === '42501' || code === 'PGRST301') return 'not-allowed';
  if (code === '23505') return 'already-done';
  if (code === 'PGRST303') return 'signed-out';
  if (/failed to fetch|network/i.test(error.message)) return 'network';
  return 'unknown';
}

function fail(action: string, error: ServerError | null): void {
  if (error) throw new DiscussionError(discussionErrorCode(error), `${action}: ${error.message}`);
}

export function toRoomBalance(
  rows: readonly { readonly stance: string; readonly posts: number }[] | null,
): RoomBalance {
  const count = (stance: string): number =>
    (rows ?? []).filter((row) => row.stance === stance).reduce((sum, row) => sum + row.posts, 0);
  return { a: count('a'), b: count('b'), neutral: count('neutral') };
}

export function createDiscussionRemote(client: DbClient): DiscussionRemote {
  const readerId = async (): Promise<string | null> => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  };

  return {
    readerId,

    async discussion(storyId) {
      const { data, error } = await client
        .from('discussions')
        .select('story_id, prompt, side_a_label, side_b_label, state, closes_at, post_count')
        .eq('story_id', storyId)
        .maybeSingle();
      fail('read the discussion', error);
      if (!data) return null;
      const info: DiscussionInfo = {
        storyId: data.story_id,
        prompt: data.prompt,
        sideA: data.side_a_label,
        sideB: data.side_b_label,
        state: data.state === 'open' ? 'open' : 'closed',
        closesAtMs: Date.parse(data.closes_at),
        postCount: data.post_count,
      };
      return info;
    },

    async posts(storyId, offset, limit) {
      const { data, error } = await client
        .from('posts')
        .select(POST_COLUMNS)
        .eq('story_id', storyId)
        .eq('mod_state', 'ok')
        .order('rank_score', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + limit - 1)
        .overrideTypes<PostRow[], { merge: false }>();
      fail('read the posts', error);
      return posts(data);
    },

    async myUnapproved(storyId) {
      const me = await readerId();
      if (me === null) return [];
      const { data, error } = await client
        .from('posts')
        .select(POST_COLUMNS)
        .eq('story_id', storyId)
        .eq('author_id', me)
        .in('mod_state', ['pending', 'hidden'])
        .order('created_at', { ascending: false })
        .overrideTypes<PostRow[], { merge: false }>();
      fail('read your posts', error);
      return posts(data);
    },

    async post(id) {
      const { data, error } = await client
        .from('posts')
        .select(POST_COLUMNS)
        .eq('id', id)
        .maybeSingle()
        .overrideTypes<PostRow | null, { merge: false }>();
      fail('read a post', error);
      return data ? toDiscussionPost(data) : null;
    },

    async topCrossSide(storyId, limit) {
      const { data, error } = await client
        .from('posts')
        .select(POST_COLUMNS)
        .eq('story_id', storyId)
        .eq('mod_state', 'ok')
        .gt('cross_side_count', 0)
        .order('cross_side_count', { ascending: false })
        .order('rank_score', { ascending: false })
        .limit(limit)
        .overrideTypes<PostRow[], { merge: false }>();
      fail('read the top posts', error);
      return posts(data);
    },

    async balance(storyId) {
      const { data, error } = await client.rpc('discussion_balance', { p_story: storyId });
      fail('read the balance', error);
      return toRoomBalance(data);
    },

    async myStance(storyId) {
      if ((await readerId()) === null) return null;
      const { data, error } = await client
        .from('discussion_stances')
        .select('stance, locked_at')
        .eq('story_id', storyId)
        .maybeSingle();
      fail('read your side', error);
      if (!data || !STANCES.has(data.stance)) return null;
      return { stance: data.stance as PostStance, locked: data.locked_at !== null };
    },

    async takeSide(storyId, stance, change) {
      if (!change) {
        const { error } = await client
          .from('discussion_stances')
          .insert({ story_id: storyId, stance });
        fail('take a side', error);
        return;
      }
      // RLS lets a locked side through as zero rows, not an error.
      const { data, error } = await client
        .from('discussion_stances')
        .update({ stance })
        .eq('story_id', storyId)
        .select('stance');
      fail('change sides', error);
      if (!data || data.length === 0)
        throw new DiscussionError('not-allowed', 'your side is fixed');
    },

    async myVotes(postIds) {
      if (postIds.length === 0 || (await readerId()) === null) return [];
      const { data, error } = await client
        .from('votes')
        .select('post_id, kind')
        .in('post_id', [...postIds]);
      fail('read your votes', error);
      return (data ?? [])
        .filter((row) => row.kind === 'helpful' || row.kind === 'changed_mind')
        .map((row) => ({ postId: row.post_id, kind: row.kind as 'helpful' | 'changed_mind' }));
    },

    async vote(postId, kind) {
      const { error } = await client.from('votes').insert({ post_id: postId, kind });
      fail('vote', error);
    },

    subscribe(storyId, feed) {
      let dropped = false;
      const idOf = (payload: unknown): string | null => {
        const id = (payload as { id?: unknown } | null)?.id;
        return typeof id === 'string' ? id : null;
      };
      const channel = client
        .channel(discussionTopic(storyId), { config: { private: false } })
        .on('broadcast', { event: 'post' }, ({ payload }) => {
          const id = idOf(payload);
          if (id) feed.onPost(id);
        })
        .on('broadcast', { event: 'gone' }, ({ payload }) => {
          const id = idOf(payload);
          if (id) feed.onGone(id);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            if (dropped) feed.onReconnect();
            dropped = false;
          } else {
            dropped = true;
          }
        });
      return () => void client.removeChannel(channel);
    },
  };
}
