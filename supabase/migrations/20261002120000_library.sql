-- Follows and saved stories for signed-in readers (Prompt 3.4). Guests keep
-- both on their device; on sign-in the app inserts the device's lists here and
-- then clears them from the device (src/state/library).
--
-- The first tables a client may write. Each person reads, adds and removes
-- only their own rows: explicit grants (no UPDATE: a follow or a save is
-- added or removed, never edited) and RLS on user_id, which defaults to the
-- caller so a client never has to send it.
--
-- No coordinates (CLAUDE.md #5). A followed place is an id the app resolves
-- with its gazetteer: `city:<Natural Earth ne_id>` or `country:<ISO-2>`. The
-- reader's home city never leaves their device at all.

-- ---------------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------------
create table public.follows (
  -- Cascade: deleting an account deletes its follows (Prompt 4.1).
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('place', 'category', 'story')),
  target     text not null,
  -- What the reader saw when following: "Tokyo, Japan", "Climate", a headline.
  label      text not null check (char_length(label) between 1 and 300),
  -- A story's source count when followed, for "+12 sources since you followed".
  baseline   integer check (baseline >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, target),
  -- One spelling per target, so a follow made on two devices merges into one.
  -- The category names are NEWS_CATEGORIES (tests/schema.test.ts keeps them in step).
  constraint follows_target_shape check (
    (kind = 'place' and target ~ '^(city:[1-9][0-9]{0,15}|country:[A-Z]{2})$')
    or (kind = 'category' and target in
        ('world', 'conflict', 'politics', 'business', 'science', 'climate', 'tech', 'health'))
    or (kind = 'story' and target ~ '^[1-9][0-9]{0,15}$')
  )
);

-- ---------------------------------------------------------------------------
-- saved_stories: snapshots, not references. Stories are pruned after 48 h and
-- a save must still say what it was, so there is no foreign key to stories.
-- ---------------------------------------------------------------------------
create table public.saved_stories (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The payload id (stories.seq), as GET /api/story/:id takes it.
  story_seq    bigint not null check (story_seq > 0),
  headline     text not null check (char_length(headline) between 1 and 300),
  place        text not null default '' check (char_length(place) <= 120),
  published_at timestamptz not null,
  saved_at     timestamptz not null default now(),
  primary key (user_id, story_seq)
);

-- Newest first, for the Saved list.
create index saved_stories_user_saved_idx on public.saved_stories (user_id, saved_at desc);

-- ---------------------------------------------------------------------------
-- Access: your own rows, read, add and remove.
-- ---------------------------------------------------------------------------
alter table public.follows enable row level security;
alter table public.saved_stories enable row level security;

grant select, insert, delete on public.follows to authenticated;
grant select, insert, delete on public.saved_stories to authenticated;

create policy "follows: read your own"
  on public.follows for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "follows: add your own"
  on public.follows for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "follows: remove your own"
  on public.follows for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "saved stories: read your own"
  on public.saved_stories for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "saved stories: add your own"
  on public.saved_stories for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "saved stories: remove your own"
  on public.saved_stories for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- An abuse bound, not a product limit: 1,000 rows per person per table, so a
-- script cannot fill the database. The product's saved-story limit is
-- AppConfig.savedStoryLimit (a tier boundary, 50 on the free tier), applied
-- by the app; moving a guest's saves up on sign-in may pass it, because
-- nothing a guest saved is dropped (Prompt 4.1). Raise this if a paid tier
-- ever allows more.
-- ---------------------------------------------------------------------------
create function public.library_row_cap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows bigint;
begin
  -- Runs as the inserting user, so RLS limits the count to their own rows. A
  -- row-level BEFORE trigger sees the rows a multi-row insert already added.
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name)
    into v_rows using new.user_id;
  if v_rows >= 1000 then
    raise exception '% is full: 1000 rows per person', tg_table_name using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke all on function public.library_row_cap() from public, anon, authenticated;

create trigger follows_row_cap before insert on public.follows
  for each row execute function public.library_row_cap();
create trigger saved_stories_row_cap before insert on public.saved_stories
  for each row execute function public.library_row_cap();
