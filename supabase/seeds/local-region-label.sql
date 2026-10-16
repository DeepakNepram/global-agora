-- Local only: the secret the API Worker sends with a post's region label
-- (Prompt 4.4). Seeds run on `db reset` and never reach a hosted project,
-- which sets its own Vault entry to match the Worker's REGION_LABEL_SECRET
-- (docs/DECISIONS.md). This value is public, so the Worker refuses it against
-- anything but the local stack.
select vault.create_secret(
  'local-only-region-label',
  'region_label_secret',
  'Local only and public: matches workers/api/.dev.vars');
