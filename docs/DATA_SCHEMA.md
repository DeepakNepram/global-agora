# Data schema

The applied schema lives in [`supabase/migrations/`](../supabase/migrations/). This
page summarizes it and states who may do what. The migrations are the source of
truth; the original design is the build plan's §3
([`../news-globe-build-plan.md`](../news-globe-build-plan.md)).

| Migration                                   | Tables                                                    |
| ------------------------------------------- | --------------------------------------------------------- |
| `20260924100000_news.sql`                   | `stories`, `articles` (+ PostGIS, deny-by-default grants) |
| `20260924100100_accounts.sql`               | `profiles`, `feature_flags`                               |
| `20260924100200_discussions.sql`            | `discussions`, `posts`, `votes`, `reports`, `blocks`      |
| `20260924120000_ingest.sql`                 | `story_signals`, `ingest_runs`, the ingest functions      |
| `20260924140000_api.sql`                    | `stories.seq`, the API read functions                     |
| `20260924150000_ingest_candidates_plan.sql` | fix: `ingest_candidates` at a full day's volume           |

Each table ships with its RLS policies and grants in the same file: a table and
its access rules are one change. Migrations are timestamped and forward-only.

## Rules that apply to every table

- **RLS on every table**, with explicit policies (CLAUDE.md #8). A pgTAP test
  fails if any table in `public` lacks RLS or a policy.
- **Deny by default.** The first migration removes Supabase's habit of granting
  every new table to `anon` and `authenticated`. Each table grants exactly what
  its policies allow, so there are two locks, and a table added later without
  grants is closed rather than open. Functions are closed too, because
  PostgREST exposes them as RPC endpoints: the ingest migration revokes
  PUBLIC's EXECUTE by default and on each function by name. Client roles may
  call exactly two, the API's read-only `api_nodes` and `api_story`, and a
  pgTAP test fails if that list changes.
- **Only the service role writes news.** The ingest Worker holds the service
  key and bypasses RLS (CLAUDE.md #9). No client role can write any table yet.
- **No precise user location, ever.** No coordinates on any user-written table.
  `posts.region_label` is coarse text from the Cloudflare IP header, capped at
  64 characters (#5). A unit test scans the user tables for coordinate columns.
- **No full article text.** Title and headline ≤ 300 characters, summary ≤ 600,
  snippet ≤ 400: enough for a headline and a lede, never a body (#6).
- **500 character limit** on `posts.body`, enforced by a CHECK constraint _and_
  in the UI (#7). `char_length` counts code points, so the UI must count the
  same way, not UTF-16 units.

## Who can do what

Grants and policies agree; `npm run db:test` checks both.

| Table           | Signed out | Signed in                               | Writes                           |
| --------------- | ---------- | --------------------------------------- | -------------------------------- |
| `stories`       | read       | read                                    | service role (ingest Worker)     |
| `articles`      | read       | read                                    | service role (ingest Worker)     |
| `discussions`   | none       | read                                    | service role (admin, Prompt 4.6) |
| `feature_flags` | none       | read                                    | service role                     |
| `posts`         | none       | read if `mod_state = 'ok'`, or your own | none yet (Prompt 4.2)            |
| `profiles`      | none       | your own row                            | none yet (Prompt 4.1)            |
| `votes`         | none       | your own votes                          | none yet (Prompt 4.2)            |
| `blocks`        | none       | blocks you made                         | none yet (Prompt 4.3)            |
| `reports`       | none       | none (explicit restrictive deny)        | service role only                |
| `story_signals` | none       | none (explicit restrictive deny)        | service role (ingest Worker)     |
| `ingest_runs`   | none       | none (explicit restrictive deny)        | service role (ingest Worker)     |

Open questions left for the prompts that own them:

- **Guests reading discussions.** Prompt 4.1 says reading stays fully
  anonymous; Prompt 2.1 allows anon reads on stories and articles only. 4.1
  decides whether discussions and approved posts become readable signed out.
- **Public profile fields.** Only your own profile is readable today. 4.1
  decides which columns (handle, display name) others may see.
- **Flags before sign-in.** Guests cannot read `feature_flags`. If the app needs
  flags before sign-in, the API Worker reads them with the service key and
  serves them.

## Tables

**`stories`**: one row per pin.

- `seq` is a short public id (identity column), the payload's `id`: 3000
  UUIDs cost 56 KB of the 150 KB payload budget, 3000 integers 5.6 KB. `id`
  (UUID) stays the primary key and every foreign key uses it.
- `category` is an index into `NEWS_CATEGORIES` (`src/core/nodeBuffer.ts`),
  0 to 7. A unit test keeps the CHECK range and the array in step.
- `lat` and `lon` are the event's location. `geog` is generated from them
  (never written) and carries the GIST index for radius queries.
- `heat` is 0 to 255 and `sentiment` −100 to 100. `place_conf` is 0 to 100 and
  backs "why this location".
- `discussion_state` is `none`, `queued`, `open` or `closed`.
- Indexes: GIST on `geog`; `published_at desc` for the payload window; heat
  among queued stories for the admin queue.

**`articles`**: one row per outlet covering a story.

- `url` is unique and must be http(s), so a `javascript:` link cannot be
  stored. `story_id` is required and cascades with its story.

**`discussions`**: opened by hand from the admin queue.

- `story_id` uses **restrict**, not cascade. The ingest cleanup deletes stories
  older than 48 hours, and a cascade would silently delete a live debate with
  everyone's posts. Prompt 2.2's cleanup must skip stories with a discussion.

**`posts`**: `stance` is a, b or neutral. `kind` is argument, eyewitness,
evidence or expert, and `evidence` requires `evidence_url`.

**`votes`**: one per user, post and kind (primary key).

**`reports`**: `reporter_id` is set to null when the reporter deletes their
account, so the moderation record survives.

**`blocks`**: a user cannot block themselves.

**`profiles`**: cascades from `auth.users`, so deleting an account deletes the
profile and, through it, that user's posts, votes and blocks (Prompt 4.1:
deletion that actually deletes). `tier` is the monetization hook, unused in v1.

**`feature_flags`**: `key`, `enabled`, an optional `value` payload.

## Ingest (Prompt 2.2)

The ingest Worker (`workers/ingest/`) is the only writer of news. It calls
these functions with the service key; no client role may execute them.

- **`ingest_claim`, `ingest_finish`:** take and close a 15-minute GDELT slot
  in `ingest_runs`, which is the cursor, the lock and the audit log. A slot
  that fails three times is skipped.
- **`ingest_known_urls`:** which of a batch's URLs are already stored.
- **`ingest_candidates`:** stored stories sharing event keys with each batch
  cluster, up to three per cluster, from the last 24 hours.
- **`ingest_apply`:** one transaction writes a slot's stories, signals and
  articles and marks the slot done. Replays change nothing. A queued, open or
  closed story keeps its title and place; heat only rises; the state only
  moves `none` → `queued`.
- **`ingest_prune`:** stories whose `published_at` is past retention (48 h)
  go, **except any with a discussion** (the RESTRICT key above). Signals go
  after the 24-hour match window, run rows after 7 days.

**`story_signals`**: the evidence a story's title, place, category and heat are
derived from: write-ups, outlets, countries, place votes and category scores.
It is versioned JSON beside the event `keys`. It is kept apart from `stories`
so public reads never carry it.

What ingest writes on `stories`:

- `place_source` is `gdelt`;
- `title_hash` is the lead write-up's 64-bit simhash;
- `heat` is the peak score;
- `sentiment` is GDELT's tone × 10;
- `source_count` is distinct outlets.

`summary` and `snippet` stay null: GDELT gives no text, and nothing fetches
pages. See [`DECISIONS.md`](DECISIONS.md) for the heat formula and grouping
rules.

## Seed data

`supabase/seed.sql` holds 200 fictional stories and about 540 articles for
local development. It is generated by `scripts/seed/generate.ts` and applied by
`npm run db:reset`.

- **Places are real cities; everything else is invented.** No real person,
  party, company or armed group is named. Outlets are made up and use the
  reserved `.example` domain. Every summary ends "Fictional seed data."
- **Times are relative to `now()`,** so every reset yields a fresh window. They
  span the 23.5 hours before the reset, so all 200 stay inside a 24-hour query
  for half an hour afterwards.
- **Five stories develop across the map during the day,** for the time
  scrubber: a market sell-off, a typhoon, an aurora, a payments outage and an
  infection cluster.
- **It never reaches a hosted project by accident.** `supabase db push` sends
  the seed only with `--include-seed`.

## API (Prompt 2.3)

The API Worker (`workers/api/`) serves the globe. It calls two read functions
with the **publishable** key, so it sees exactly what a signed-out visitor
may: both run as the caller, under RLS.

- **`api_nodes(p_hours, p_limit, p_known)`:** the payload's columns, built in
  SQL (one row, so PostgREST's row cap never applies). Returns
  `{hash, payload}`, or `{hash}` alone when `p_known` is the current hash.
- **`api_story(p_seq | p_id, p_article_limit)`:** one story in full, or null.

Both refuse out-of-range arguments (hours 1–720, limit 1–10,000, articles
1–5,000): safety bounds on functions any client can call. The product limits
are the Worker's config.

## Client payload

`GET /api/nodes?hours=24`. The globe never queries tables directly; it loads
this once and re-checks it every `payloadRefreshSeconds` (`src/core/config.ts`).
Source of the format: `src/core/data/payload.ts`, used by the Worker to
validate what it serves and by the client to validate what it decodes.

```json
{
  "v": 1,
  "generated_at": 1790243100,
  "window_hours": 24,
  "categories": [
    "world",
    "conflict",
    "politics",
    "business",
    "science",
    "climate",
    "tech",
    "health"
  ],
  "nodes": {
    "id": [23904, 23911],
    "lonQ": [-23, 25431],
    "latQ": [18756, 12990],
    "t": [60, 80000],
    "cat": [2, 3],
    "heat": [200, 150],
    "srcN": [12, 3],
    "disc": [1, 0],
    "hl": ["Vote nears in London", "Shares slide in Tokyo"],
    "pl": ["London, United Kingdom", "Tokyo, Japan"]
  }
}
```

- **`generated_at`** is the window end in epoch seconds: the newest story's
  first-seen or publish time, not the time of the request. The same data
  always gives the same bytes.
- **Nodes** are the `API_NODE_LIMIT` (3000) hottest stories published in the
  window, **in time order** (then `id`). Node `i` is index `i` of every column.
- **`id`**: `stories.seq`. `GET /api/story/:id` takes it.
- **`lonQ`, `latQ`**: int16 fixed point. `lonQ = round(lon / 180 × 32767)`,
  `latQ = round(lat / 90 × 32767)`: ~610 m steps at the equator.
- **`t`**: whole seconds after `generated_at − window_hours × 3600`.
- **`cat`**: index into this payload's `categories` (the client maps by name).
- **`heat`** 0–255; **`srcN`** distinct outlets; **`disc`** 1 when the
  discussion is open.
- **`hl`, `pl`**: headline and place name (empty when unknown).
  Everything else loads on tap from `/api/story/:id`.

Measured end to end on a real 24 h window: 3000 nodes are 134,646 bytes
(131.5 KB) with Brotli 11; 415.7 KB decoded.

**HTTP:** `Content-Encoding: br` when accepted (identity JSON otherwise),
weak `ETag`, `If-None-Match` → 304, and
`Cache-Control: public, max-age=60, stale-while-revalidate=900,
stale-if-error=86400`, plus `no-transform` on Brotli replies so the edge never
re-encodes them. `hours` must be 1 to `API_MAX_HOURS` (24 on the free
tier); anything else is a 400.

**`GET /api/story/:id`** (`:id` is the payload id or the UUID) returns the
story with its `summary`, `category` (by name), heat, sentiment, times,
`place` (name, lat, lon, `source`, `confidence`, country: the provenance
behind "why this location"), `discussion.state`, `article_count`, and
`articles` newest first (outlet, country, headline, URL, published time,
snippet), capped at `API_STORY_ARTICLE_LIMIT` (1000). 404 when unknown.

## Monetization hooks (present, unused)

`profiles.tier`, the `feature_flags` table, and config values for history depth,
saved-story limits and alert counts. Defaults live in `src/core/config.ts`.
