-- Accounts: profiles, plus the feature_flags monetization hook (CLAUDE.md).
--
-- Read-only for clients in Prompt 2.1. Prompt 4.1 adds the write paths
-- (onboarding, handle choice, rules acceptance) together with their checks, so
-- that no column like tier or strikes is ever self-writable by accident.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  -- Cascade: Prompt 4.1 requires account deletion that actually deletes.
  id                uuid primary key references auth.users (id) on delete cascade,
  handle            text not null unique,
  display_name      text,
  tier              text not null default 'free',  -- monetization hook, unused in v1
  trust_level       smallint not null default 0,
  rules_accepted_at timestamptz,
  is_adult          boolean not null default false,
  strikes           smallint not null default 0 check (strikes >= 0),
  created_at        timestamptz not null default now()
);

alter table public.profiles enable row level security;

grant select on public.profiles to authenticated;

-- Own row only for now. Reading other people's public fields (handles on
-- posts) arrives with 4.1, which decides which columns count as public.
create policy "profiles: read your own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- feature_flags
-- ---------------------------------------------------------------------------
create table public.feature_flags (
  key         text primary key check (key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  enabled     boolean not null default false,
  value       jsonb,  -- optional payload, e.g. a per-tier limit
  description text,
  updated_at  timestamptz not null default now()
);

alter table public.feature_flags enable row level security;

grant select on public.feature_flags to authenticated;

-- Signed-in clients may read flags. Guests are not given anon read (2.1 allows
-- anon on stories and articles only); when the app needs flags before sign-in,
-- the API Worker reads them with the service key and serves them.
create policy "feature flags: signed-in read"
  on public.feature_flags for select
  to authenticated
  using (true);
