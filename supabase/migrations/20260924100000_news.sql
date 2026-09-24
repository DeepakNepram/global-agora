-- News: stories (one row = one pin) and articles (one row per outlet covering it).
--
-- Source: build plan §3, with constraints added so the database itself refuses
-- data the product rules forbid. See docs/DATA_SCHEMA.md for the access matrix.

-- ---------------------------------------------------------------------------
-- Deny by default, for every table this project will ever create in `public`.
--
-- Supabase grants each new public table to `anon` and `authenticated` and leaves
-- RLS as the only lock. We take that default away, so every table must grant
-- exactly what its policies allow: two locks instead of one, and a table
-- created later without grants is closed rather than open. Functions get the
-- same treatment because PostgREST exposes them as RPC endpoints; grant EXECUTE
-- explicitly on any function a client role must call, including helpers used
-- inside policies. `service_role` keeps its default grants (it bypasses RLS and
-- lives only in Workers; CLAUDE.md #9).
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Supabase's convention: extensions live outside `public`, so their functions
-- never show up as API endpoints.
create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- stories
-- ---------------------------------------------------------------------------
create table public.stories (
  id               uuid primary key default gen_random_uuid(),
  -- Length caps back CLAUDE.md #6 (headline, snippet, link out; never a body).
  title            text not null check (char_length(title) between 1 and 300),
  summary          text check (char_length(summary) <= 600),
  -- Index into NEWS_CATEGORIES (src/core/nodeBuffer.ts). Appending a category
  -- means a migration that widens this range; tests/schema.test.ts checks both.
  category         smallint not null
                     constraint stories_category_range check (category between 0 and 7),
  lat              double precision not null check (lat between -90 and 90),
  lon              double precision not null check (lon between -180 and 180),
  -- Derived, never written: the GIST index needs a geography value and lat/lon
  -- stay the payload's source. Schema-qualified because PostGIS lives in
  -- `extensions`, and a stored expression must not depend on search_path.
  geog             extensions.geography(Point, 4326) generated always as (
                     extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)::extensions.geography
                   ) stored,
  place_name       text check (char_length(place_name) <= 120),
  place_source     text check (place_source in ('gdelt', 'dateline', 'manual')),
  place_conf       smallint check (place_conf between 0 and 100),  -- "why this location"
  country_code     char(2) check (country_code ~ '^[A-Z]{2}$'),
  heat             smallint not null default 0 check (heat between 0 and 255),
  sentiment        smallint not null default 0 check (sentiment between -100 and 100),
  source_count     smallint not null default 1 check (source_count >= 1),
  published_at     timestamptz not null,
  first_seen_at    timestamptz not null default now(),
  title_hash       bigint,  -- 64-bit simhash for near-duplicate detection (Prompt 2.2)
  discussion_state text not null default 'none'
                     check (discussion_state in ('none', 'queued', 'open', 'closed'))
);

create index stories_geog_gist on public.stories using gist (geog);
-- The payload query: everything published inside the history window.
create index stories_published_at_idx on public.stories (published_at desc);
-- The admin queue: hottest queued stories first.
create index stories_queued_heat_idx on public.stories (heat desc)
  where discussion_state = 'queued';

-- ---------------------------------------------------------------------------
-- articles
-- ---------------------------------------------------------------------------
create table public.articles (
  id             uuid primary key default gen_random_uuid(),
  story_id       uuid not null references public.stories (id) on delete cascade,
  -- http(s) only: these become links, and a javascript: URL would be a script.
  url            text not null unique
                   check (url ~* '^https?://' and char_length(url) <= 2048),
  outlet         text check (char_length(outlet) <= 120),
  outlet_country char(2) check (outlet_country ~ '^[A-Z]{2}$'),
  headline       text not null check (char_length(headline) between 1 and 300),
  snippet        text check (char_length(snippet) <= 400),
  image_url      text check (image_url ~* '^https?://' and char_length(image_url) <= 2048),
  published_at   timestamptz,
  lang           char(2) check (lang ~ '^[a-z]{2}$')
);

-- "Covered by N sources" and the cascade from stories both look up by story.
create index articles_story_id_idx on public.articles (story_id);

-- ---------------------------------------------------------------------------
-- Access: anyone may read news; only the ingest Worker (service role) writes.
-- There are deliberately no insert/update/delete grants or policies here.
-- ---------------------------------------------------------------------------
alter table public.stories enable row level security;
alter table public.articles enable row level security;

grant select on public.stories, public.articles to anon, authenticated;

create policy "news is public: stories"
  on public.stories for select
  to anon, authenticated
  using (true);

create policy "news is public: articles"
  on public.articles for select
  to anon, authenticated
  using (true);
