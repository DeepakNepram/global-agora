/**
 * Edge Function: check a new post with OpenAI and Google, then record the
 * answer (Prompt 4.3). The logic is in ../_shared/moderation/handler.ts.
 *
 * Called only by the database (pg_net), with the hook secret; JWT checks are
 * off for it in supabase/config.toml. Its settings are described in
 * ../_shared/moderation/env.ts.
 */
import { moderationEnv } from '../_shared/moderation/env.ts';
import { handleModeration } from '../_shared/moderation/handler.ts';

Deno.serve((request: Request) =>
  handleModeration(
    request,
    moderationEnv((name) => Deno.env.get(name)),
    fetch,
  ),
);
