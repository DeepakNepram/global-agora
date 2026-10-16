/**
 * Posting for the signed-in reader (Prompt 4.4): their access token, taken
 * from the session here, goes with each post to the API Worker, which posts
 * as them. Imported directly, not through the db barrel: only Prompt 4.5's
 * composer needs it.
 */

// Explicit .ts: scripts/db/smoke.ts loads this under plain Node, which needs it.
import type { FetchLike } from '../data/nodes.ts';
import {
  fetchLocalBadge,
  PostingError,
  submitPost,
  type PostDraft,
  type PostingRemote,
  type SubmittedPost,
} from '../posting.ts';
import type { DbClient } from './client';

export interface PostingRemoteOptions {
  /** AppConfig.apiBaseUrl, e.g. "/api". */
  readonly apiBaseUrl: string;
  readonly fetch: FetchLike;
}

export function createPostingRemote(
  client: DbClient,
  options: PostingRemoteOptions,
): PostingRemote {
  return {
    localBadge: () => fetchLocalBadge(options.apiBaseUrl, options.fetch),

    async submit(draft: PostDraft): Promise<SubmittedPost> {
      // getSession refreshes an expired token before handing it over.
      const { data, error } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (error !== null || token === undefined) {
        throw new PostingError('signed-out', 'sign in to post');
      }
      return submitPost({ apiBaseUrl: options.apiBaseUrl, token, draft, fetch: options.fetch });
    },
  };
}
