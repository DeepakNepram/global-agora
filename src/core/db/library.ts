/**
 * The library's account side over Supabase (`follows`, `saved_stories`,
 * 20261002120000_library.sql). Rows are the signed-in reader's own: RLS
 * scopes every read and delete, and user_id defaults to the caller, so it is
 * never sent. Adds ignore rows the account already has, which makes moving a
 * device's library up safe to repeat.
 */

// Explicit .ts: scripts/db/smoke.ts loads this under plain Node, which needs it.
import { isFollow, type Follow } from '../follows.ts';
import { isSavedStory, type LibraryRemote, type SavedStory } from '../library.ts';
import type { DbClient } from './client';

export class LibraryError extends Error {
  override readonly name: string = 'LibraryError';
}

function fail(action: string, error: { message: string } | null): void {
  if (error) throw new LibraryError(`${action}: ${error.message}`);
}

export function createLibraryRemote(client: DbClient): LibraryRemote {
  return {
    async listFollows() {
      const { data, error } = await client
        .from('follows')
        .select('kind, target, label, baseline, created_at')
        .order('created_at', { ascending: false });
      fail('list follows', error);
      return (data ?? [])
        .map((row) => ({
          kind: row.kind,
          target: row.target,
          label: row.label,
          baseline: row.baseline,
          createdAtMs: Date.parse(row.created_at),
        }))
        .filter(isFollow);
    },

    async addFollows(follows: readonly Follow[]) {
      if (follows.length === 0) return;
      const { error } = await client.from('follows').upsert(
        follows.map((follow) => ({
          kind: follow.kind,
          target: follow.target,
          label: follow.label,
          baseline: follow.baseline,
          created_at: new Date(follow.createdAtMs).toISOString(),
        })),
        { onConflict: 'user_id,kind,target', ignoreDuplicates: true },
      );
      fail('add follows', error);
    },

    async removeFollow(kind, target) {
      const { error } = await client.from('follows').delete().eq('kind', kind).eq('target', target);
      fail('remove a follow', error);
    },

    async listSaved() {
      const { data, error } = await client
        .from('saved_stories')
        .select('story_seq, headline, place, published_at, saved_at')
        .order('saved_at', { ascending: false });
      fail('list saved stories', error);
      return (data ?? [])
        .map((row) => ({
          id: row.story_seq,
          headline: row.headline,
          place: row.place,
          publishedAtMs: Date.parse(row.published_at),
          savedAtMs: Date.parse(row.saved_at),
        }))
        .filter(isSavedStory);
    },

    async addSaved(stories: readonly SavedStory[]) {
      if (stories.length === 0) return;
      const { error } = await client.from('saved_stories').upsert(
        stories.map((story) => ({
          story_seq: story.id,
          headline: story.headline,
          place: story.place,
          published_at: new Date(story.publishedAtMs).toISOString(),
          saved_at: new Date(story.savedAtMs).toISOString(),
        })),
        { onConflict: 'user_id,story_seq', ignoreDuplicates: true },
      );
      fail('add saved stories', error);
    },

    async removeSaved(id) {
      const { error } = await client.from('saved_stories').delete().eq('story_seq', id);
      fail('remove a saved story', error);
    },
  };
}
