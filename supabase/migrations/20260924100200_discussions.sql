-- Discussions: discussions, posts, votes, reports, blocks.
--
-- Prompt 2.1 creates the tables and a strict read-only access baseline. The
-- write paths (posting into open discussions, voting, reporting, blocking) and
-- the ranking trigger arrive in Prompts 4.2-4.3 with their own checks, so for
-- now no client role can write any of these tables.

-- ---------------------------------------------------------------------------
-- discussions
-- ---------------------------------------------------------------------------
create table public.discussions (
  -- Restrict, not the build plan's cascade: the ingest cleanup deletes stories
  -- older than 48 h (Prompt 2.2), and a cascade would silently delete a live
  -- debate and everyone's posts with it. Restrict makes that mistake fail loudly.
  story_id     uuid primary key references public.stories (id) on delete restrict,
  prompt       text not null check (char_length(prompt) > 0),
  side_a_label text not null check (char_length(side_a_label) > 0),
  side_b_label text not null check (char_length(side_b_label) > 0),
  opened_at    timestamptz not null default now(),
  closes_at    timestamptz not null,  -- typically opened_at + 48 h
  state        text not null default 'open' check (state in ('open', 'closed')),
  post_count   integer not null default 0 check (post_count >= 0),
  constraint discussions_closes_after_opening check (closes_at > opened_at)
);

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
create table public.posts (
  id                 uuid primary key default gen_random_uuid(),
  story_id           uuid not null references public.discussions (story_id) on delete cascade,
  author_id          uuid not null references public.profiles (id) on delete cascade,
  -- CLAUDE.md #7. char_length counts code points; the UI must count the same
  -- way (not UTF-16 units) or an emoji-heavy post passes one check and fails the other.
  body               text not null
                       constraint posts_body_length check (char_length(body) between 1 and 500),
  stance             text not null check (stance in ('a', 'b', 'neutral')),
  kind               text not null check (kind in ('argument', 'eyewitness', 'evidence', 'expert')),
  evidence_url       text check (evidence_url ~* '^https?://' and char_length(evidence_url) <= 2048),
  -- CLAUDE.md #5: a coarse text label from the Cloudflare IP header, or null.
  -- Capped so nothing longer than a city name can be stored here.
  region_label       text check (char_length(region_label) <= 64),
  mod_state          text not null default 'pending'
                       check (mod_state in ('pending', 'ok', 'hidden', 'removed')),
  mod_scores         jsonb,
  helpful_count      integer not null default 0 check (helpful_count >= 0),
  cross_side_count   integer not null default 0 check (cross_side_count >= 0),
  changed_mind_count integer not null default 0 check (changed_mind_count >= 0),
  rank_score         real not null default 0,
  created_at         timestamptz not null default now(),
  constraint posts_evidence_needs_url check (kind <> 'evidence' or evidence_url is not null)
);

-- A discussion's posts, best first.
create index posts_story_rank_idx on public.posts (story_id, rank_score desc);
create index posts_author_idx on public.posts (author_id);

-- ---------------------------------------------------------------------------
-- votes
-- ---------------------------------------------------------------------------
create table public.votes (
  post_id      uuid not null references public.posts (id) on delete cascade,
  voter_id     uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('helpful', 'changed_mind')),
  voter_stance text check (voter_stance in ('a', 'b', 'neutral')),  -- captured at vote time
  created_at   timestamptz not null default now(),
  primary key (post_id, voter_id, kind)
);

create index votes_voter_idx on public.votes (voter_id);

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  -- Set null, not cascade: a reporter deleting their account must not erase
  -- the moderation record of what was reported and what was done about it.
  reporter_id uuid references public.profiles (id) on delete set null,
  reason      text not null check (char_length(reason) > 0),
  state       text not null default 'open' check (state in ('open', 'actioned', 'dismissed')),
  created_at  timestamptz not null default now()
);

create index reports_post_idx on public.reports (post_id);
create index reports_reporter_idx on public.reports (reporter_id);
-- The moderation queue: oldest open report first.
create index reports_open_idx on public.reports (created_at) where state = 'open';

-- ---------------------------------------------------------------------------
-- blocks
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

-- ---------------------------------------------------------------------------
-- Access. Nothing here is visible without auth (Prompt 2.1), and nothing is
-- writable by any client role until 4.2-4.3 add write policies.
-- ---------------------------------------------------------------------------
alter table public.discussions enable row level security;
alter table public.posts enable row level security;
alter table public.votes enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;

grant select on public.discussions, public.posts, public.votes, public.blocks to authenticated;

create policy "discussions: signed-in read"
  on public.discussions for select
  to authenticated
  using (true);

-- Moderated posts are public to signed-in readers; your own are visible to you
-- in any state (4.3: a hidden post stays visible to its author). 4.2 adds
-- hiding blocked authors.
create policy "posts: approved, or your own"
  on public.posts for select
  to authenticated
  using (mod_state = 'ok' or author_id = (select auth.uid()));

create policy "votes: read your own"
  on public.votes for select
  to authenticated
  using (voter_id = (select auth.uid()));

create policy "blocks: read your own"
  on public.blocks for select
  to authenticated
  using (blocker_id = (select auth.uid()));

-- Prompt 4.2: "nobody can read the reports table except service role". There
-- are no grants either; this restrictive policy states the rule in the table
-- itself, so a grant added by mistake still reads nothing.
create policy "reports: service role only"
  on public.reports as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);
