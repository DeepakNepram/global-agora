/** The admins' queue over Supabase (Prompt 4.3): moderation_queue() and moderate_post(). */

import type { AdminRemote, QueueItem, QueuedFor } from '../moderationQueue';
import type { DbClient } from './client';
// Explicit .ts: scripts/db/smoke.ts loads this under plain Node, which needs it.
import { fail } from './moderation.ts';

interface QueueRow {
  readonly post_id: string;
  readonly story_id: string;
  readonly prompt: string;
  readonly side_label: string;
  readonly body: string;
  readonly kind: string;
  readonly evidence_url: string | null;
  readonly created_at: string;
  readonly author_id: string;
  readonly author_handle: string;
  readonly author_strikes: number;
  readonly author_suspended: boolean;
  readonly strikes_to_suspend: number;
  readonly queued_for: string;
  readonly waiting_since: string;
  readonly report_count: number;
  readonly report_reasons: unknown;
  readonly toxicity: number | null;
  readonly flagged: readonly string[] | null;
}

function reasons(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
}

export function toQueueItem(row: QueueRow): QueueItem {
  const queuedFor: QueuedFor =
    row.queued_for === 'hidden' || row.queued_for === 'unchecked' ? row.queued_for : 'reported';
  return {
    postId: row.post_id,
    storyId: row.story_id,
    prompt: row.prompt,
    sideLabel: row.side_label,
    body: row.body,
    kind: row.kind,
    evidenceUrl: row.evidence_url,
    createdAtMs: Date.parse(row.created_at),
    authorId: row.author_id,
    authorHandle: row.author_handle,
    authorStrikes: row.author_strikes,
    authorSuspended: row.author_suspended,
    strikesToSuspend: row.strikes_to_suspend,
    queuedFor,
    waitingSinceMs: Date.parse(row.waiting_since),
    reportCount: row.report_count,
    reportReasons: reasons(row.report_reasons),
    toxicity: row.toxicity,
    flagged: row.flagged ?? [],
  };
}

export function createAdminRemote(client: DbClient): AdminRemote {
  return {
    async queue(limit) {
      const { data, error } = await client.rpc('moderation_queue', { p_limit: limit });
      fail('read the queue', error);
      // The generated types cannot know which columns may be null.
      return ((data ?? []) as readonly QueueRow[]).map(toQueueItem);
    },

    async act(postId, action) {
      const { data, error } = await client.rpc('moderate_post', {
        p_post: postId,
        p_action: action,
      });
      fail(`${action} the post`, error);
      return data === 'ok' ? 'ok' : 'removed';
    },
  };
}
