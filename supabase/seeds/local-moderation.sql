-- Local only: where the database sends new posts for moderation (Prompt
-- 4.3), and the hook secret the function checks. Seeds run on `db reset`
-- and never reach a hosted project, which sets its own two Vault entries
-- (docs/DECISIONS.md). This secret is public, so the function refuses it
-- against anything but the local stack.
select vault.create_secret(
  'http://kong:8000/functions/v1/moderate-post',
  'moderation_function_url',
  'The moderate-post Edge Function, through the local API gateway');
select vault.create_secret(
  'local-only-moderation-hook',
  'moderation_hook_secret',
  'Local only and public: matches supabase/functions/.env');
