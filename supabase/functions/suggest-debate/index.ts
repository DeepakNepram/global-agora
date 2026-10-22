/**
 * Edge Function: suggest a debate prompt and two side labels for a queued
 * story, with Claude (Prompt 4.6). The logic is in ../_shared/debate/.
 *
 * Called by the admin console with the admin's token (JWT checks on); the
 * database refuses anyone else. Its settings are described in
 * ../_shared/debate/env.ts.
 */
import { createClaudeSuggester } from '../_shared/debate/claude.ts';
import { debateEnv } from '../_shared/debate/env.ts';
import { handleSuggestDebate } from '../_shared/debate/handler.ts';

Deno.serve((request: Request) => {
  const env = debateEnv((name) => Deno.env.get(name));
  const claude = typeof env === 'string' ? null : env.claude;
  return handleSuggestDebate(request, env, {
    fetch,
    suggester: claude === null ? null : createClaudeSuggester(claude, fetch),
  });
});
