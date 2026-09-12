# Data schema

> Stub. The full v1 schema — `stories`, `articles`, `discussions`, `posts`,
> `votes`, `reports`, `blocks`, `profiles` — is specified in
> [`../news-globe-build-plan.md`](../news-globe-build-plan.md) §3. It moves here,
> as applied SQL, when Phase 2 writes the first migration.

## Rules that apply to every table

- **RLS on every table.** No table ships without row-level security policies.
  (CLAUDE.md hard constraint #8.)
- **No precise user location, ever.** No coordinates on any user-generated row.
  `posts.region_label` is coarse text derived from the Cloudflare IP header at
  post time, and nothing else. (#5)
- **No full article text.** Headline, snippet, link out. Never the body. (#6)
- **500 character limit** on `posts.body`, enforced by a CHECK constraint _and_
  in the UI. (#7)

## Migrations

`supabase/migrations/` — timestamped, forward-only. Each migration ships with its
RLS policies in the same file; a table and its policies are one change.

## Client payload

The globe does not query tables directly. It reads one columnar JSON payload
(§3 of the build plan) with int16 fixed-point coordinates, held in typed arrays.

## Monetization hooks (present, unused)

`profiles.tier`, a `feature_flags` table, and config values for history depth,
saved-story limits and alert counts. Defaults live in `src/core/config.ts`.
