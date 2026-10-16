-- Discussions (Prompt 4.2): who may read, post and vote.
--
-- 2.1 made the tables read-only. This adds the write paths, each as narrow
-- as the prompt allows:
-- - posts are readable when approved and the reader has not blocked their
--   author (and always by their author); guests read approved posts;
-- - posts go in only from accounts that agreed to the rules, into a
--   discussion that is open and not past its close time;
-- - votes go in once per person, post and kind (the primary key);
-- - reports stay service-role only (2.1's restrictive deny).
--
-- Stances. Each reader takes one side per discussion (a, b or neutral),
-- recorded here by the server, and every post and vote they make there takes
-- it from that record. A client never sends the stance a vote counts with,
-- so nobody can claim the other side to inflate a post's cross-side count.
-- The stance can change until the reader first posts or votes; then it is
-- fixed.
--
-- Counts. A vote's triggers keep the post's helpful, cross-side and
-- changed-my-mind counts; the rank follows from them (the next migration).
-- Cross-side counts a helpful vote only when voter and post are on opposite
-- named sides, a against b: neutral is neither (the owner's call).

-- ---------------------------------------------------------------------------
-- private: helpers that policies and triggers call. PostgREST exposes only
-- public and graphql_public (supabase/config.toml), so nothing here is an
-- API endpoint; client roles get USAGE so policies can call what is granted.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

-- Whether the caller may take part: their account agreed to the community
-- rules (4.1). Definer, because rules_accepted_at is not readable by clients.
-- Suspension (Prompt 4.3) belongs here too.
create function private.can_take_part()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.rules_accepted_at is not null
  );
$$;

revoke all on function private.can_take_part() from public, anon, authenticated;
grant execute on function private.can_take_part() to authenticated;

-- ---------------------------------------------------------------------------
-- discussions: anyone may read them (Prompt 4.1: reading stays anonymous);
-- only the service role opens them (Prompt 4.6).
-- ---------------------------------------------------------------------------
grant select on public.discussions to anon;

drop policy "discussions: signed-in read" on public.discussions;
create policy "discussions: anyone reads"
  on public.discussions for select
  to anon, authenticated
  using (true);

-- "Auto-close 48 hours after opening" (Prompt 4.2): the close time defaults
-- to that, and the close job (20261016130000) looks for open ones past it.
alter table public.discussions alter column closes_at set default now() + interval '48 hours';
create index discussions_open_closes_idx on public.discussions (closes_at) where state = 'open';

-- ---------------------------------------------------------------------------
-- discussion_stances
-- ---------------------------------------------------------------------------
create table public.discussion_stances (
  story_id  uuid not null references public.discussions (story_id) on delete cascade,
  -- Cascade: deleting an account deletes its stances (Prompt 4.1).
  user_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  stance    text not null check (stance in ('a', 'b', 'neutral')),
  chosen_at timestamptz not null default now(),
  -- Set by the first post or vote; from then on the stance cannot change.
  locked_at timestamptz,
  primary key (story_id, user_id)
);

create index discussion_stances_user_idx on public.discussion_stances (user_id);

alter table public.discussion_stances enable row level security;

-- Your own only: the room's balance is read from posts (Prompt 4.5), and who
-- took which side is nobody else's business.
grant select on public.discussion_stances to authenticated;
grant insert (story_id, stance) on public.discussion_stances to authenticated;
grant update (stance) on public.discussion_stances to authenticated;

create policy "discussion stances: read your own"
  on public.discussion_stances for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "discussion stances: take a side in an open discussion"
  on public.discussion_stances for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (select private.can_take_part())
    and exists (select 1 from public.discussions d
                 where d.story_id = discussion_stances.story_id
                   and d.state = 'open' and d.closes_at > now())
  );

create policy "discussion stances: change sides until you post or vote"
  on public.discussion_stances for update to authenticated
  using ((select auth.uid()) = user_id and locked_at is null)
  with check (
    (select auth.uid()) = user_id
    and locked_at is null
    and exists (select 1 from public.discussions d
                 where d.story_id = discussion_stances.story_id
                   and d.state = 'open' and d.closes_at > now())
  );

-- ---------------------------------------------------------------------------
-- posts: read by column, written by those taking part.
-- ---------------------------------------------------------------------------

-- Every column but mod_scores: a moderation score is never public, not even
-- to the post's author.
revoke select on public.posts from authenticated;
grant select (id, story_id, author_id, body, stance, kind, evidence_url, region_label,
              mod_state, helpful_count, cross_side_count, changed_mind_count, rank_score,
              created_at)
  on public.posts to anon, authenticated;

drop policy "posts: approved, or your own" on public.posts;

create policy "posts: approved"
  on public.posts for select to anon
  using (mod_state = 'ok');

-- 4.2: hidden when the reader has blocked the author. Prompt 4.3 widens this
-- to both directions when blocks become writable. Your own posts show to you
-- in any state (4.3: a hidden post stays visible to its author).
create policy "posts: approved and not blocked, or your own"
  on public.posts for select to authenticated
  using (
    author_id = (select auth.uid())
    or (mod_state = 'ok'
        and not exists (select 1 from public.blocks b
                         where b.blocker_id = (select auth.uid())
                           and b.blocked_id = posts.author_id))
  );

-- What a client may send. The author is the caller (default), the stance is
-- their side (filled in below), and moderation state, counts and the region
-- label (Prompt 4.4) are never theirs to set.
alter table public.posts alter column author_id set default auth.uid();
grant insert (story_id, body, stance, kind, evidence_url) on public.posts to authenticated;

create policy "posts: take part in an open discussion"
  on public.posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (select private.can_take_part())
    -- The side the author took here; no recorded side, no post.
    and stance = (select s.stance from public.discussion_stances s
                   where s.story_id = posts.story_id and s.user_id = (select auth.uid()))
    and exists (select 1 from public.discussions d
                 where d.story_id = posts.story_id
                   and d.state = 'open' and d.closes_at > now())
  );

-- A post without a stance takes its author's side; one sent with a stance
-- must match it (the policy above), so the client may leave it out.
create function private.posts_fill_stance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stance is null then
    select s.stance into new.stance
      from public.discussion_stances s
     where s.story_id = new.story_id and s.user_id = new.author_id;
  end if;
  return new;
end;
$$;

create trigger posts_fill_stance before insert on public.posts
  for each row execute function private.posts_fill_stance();

-- ---------------------------------------------------------------------------
-- votes: once per person, post and kind, on posts you can see, not your own.
-- ---------------------------------------------------------------------------
alter table public.votes alter column voter_id set default auth.uid();
-- voter_stance is not granted: the server copies it from the voter's side.
grant insert (post_id, kind) on public.votes to authenticated;

create policy "votes: take part on a post you can see"
  on public.votes for insert to authenticated
  with check (
    voter_id = (select auth.uid())
    and (select private.can_take_part())
    -- Filled from the voter's recorded side; no side, no vote.
    and voter_stance is not null
    -- The posts RLS applies here too: approved, author not blocked.
    and exists (
      select 1 from public.posts p
        join public.discussions d on d.story_id = p.story_id
       where p.id = votes.post_id
         and p.mod_state = 'ok'
         and p.author_id <> (select auth.uid())
         and d.state = 'open' and d.closes_at > now()
    )
  );

-- The voter's side, from the record and never from the client.
create function private.votes_take_stance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stance text;
begin
  select s.stance into v_stance
    from public.posts p
    join public.discussion_stances s on s.story_id = p.story_id and s.user_id = new.voter_id
   where p.id = new.post_id;
  -- The service role and fixtures may vote without a record, with the stance
  -- they give; a client cannot send one (no column grant), so for them this
  -- is the only source.
  if v_stance is not null then
    new.voter_stance := v_stance;
  end if;
  return new;
end;
$$;

create trigger votes_take_stance before insert on public.votes
  for each row execute function private.votes_take_stance();

-- ---------------------------------------------------------------------------
-- After a post or vote: fix the stance, keep the counts.
-- ---------------------------------------------------------------------------

-- The first post or vote in a discussion fixes the side taken there.
create function private.lock_stance(p_story uuid, p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.discussion_stances s
     set locked_at = now()
   where s.story_id = p_story and s.user_id = p_user and s.locked_at is null;
$$;

revoke all on function private.lock_stance(uuid, uuid) from public, anon, authenticated;

create function private.posts_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lock_stance(new.story_id, new.author_id);
  if new.mod_state = 'ok' then
    update public.discussions set post_count = post_count + 1 where story_id = new.story_id;
  end if;
  return null;
end;
$$;

-- post_count is the approved posts: what a reader can see.
create function private.posts_count_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was boolean := tg_op <> 'INSERT' and old.mod_state = 'ok';
  v_is boolean := tg_op <> 'DELETE' and new.mod_state = 'ok';
  v_story uuid := case when tg_op = 'DELETE' then old.story_id else new.story_id end;
begin
  if v_was <> v_is then
    update public.discussions
       set post_count = greatest(post_count + case when v_is then 1 else -1 end, 0)
     where story_id = v_story;
  end if;
  return null;
end;
$$;

create trigger posts_after_insert after insert on public.posts
  for each row execute function private.posts_after_insert();
create trigger posts_count_approved after update of mod_state or delete on public.posts
  for each row execute function private.posts_count_approved();

-- A vote moves its post's counts; a deleted vote (its voter's account went)
-- moves them back, so the counts are always the votes that exist.
-- Cross-side: a helpful vote from the opposite named side, a against b.
create function private.votes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vote public.votes := case when tg_op = 'DELETE' then old else new end;
  v_step integer := case when tg_op = 'DELETE' then -1 else 1 end;
  v_post_stance text;
  v_cross integer;
begin
  select p.stance into v_post_stance from public.posts p where p.id = v_vote.post_id;
  if not found then
    return null;  -- the post itself is being deleted
  end if;
  v_cross := case
    when v_vote.kind = 'helpful'
     and v_vote.voter_stance in ('a', 'b')
     and v_post_stance in ('a', 'b')
     and v_vote.voter_stance <> v_post_stance then 1
    else 0 end;
  update public.posts p
     set helpful_count = greatest(p.helpful_count
                                  + case when v_vote.kind = 'helpful' then v_step else 0 end, 0),
         cross_side_count = greatest(p.cross_side_count + v_cross * v_step, 0),
         changed_mind_count = greatest(p.changed_mind_count
                                       + case when v_vote.kind = 'changed_mind' then v_step else 0 end, 0)
   where p.id = v_vote.post_id;
  if tg_op = 'INSERT' then
    perform private.lock_stance(
      (select p.story_id from public.posts p where p.id = v_vote.post_id), v_vote.voter_id);
  end if;
  return null;
end;
$$;

create trigger votes_count after insert or delete on public.votes
  for each row execute function private.votes_count();

revoke all on function
  private.posts_fill_stance(),
  private.votes_take_stance(),
  private.posts_after_insert(),
  private.posts_count_approved(),
  private.votes_count()
from public, anon, authenticated;
