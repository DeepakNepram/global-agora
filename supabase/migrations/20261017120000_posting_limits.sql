-- Posting limits (Prompt 4.3): at most 5 posts an hour and 1 every 30
-- seconds; accounts under 24 hours old, 2 an hour.
--
-- Config values, not literals, and per tier (CLAUDE.md: a limit like this
-- may become a paid tier boundary): one row per profiles.tier, 'free' being
-- the fallback. Tune with `update private.posting_limits set ...`.
--
-- Every post the author inserted counts, whatever moderation made of it:
-- a spammer gains nothing from having posts removed.

create table private.posting_limits (
  tier                       text primary key,
  posts_per_hour             smallint not null check (posts_per_hour >= 1),
  seconds_between_posts      integer not null check (seconds_between_posts >= 0),
  -- An account younger than this (auth.users.created_at) gets the lower cap.
  new_account_hours          integer not null check (new_account_hours >= 0),
  new_account_posts_per_hour smallint not null check (new_account_posts_per_hour >= 1)
);

insert into private.posting_limits
  (tier, posts_per_hour, seconds_between_posts, new_account_hours, new_account_posts_per_hour)
values ('free', 5, 30, 24, 2);

alter table private.posting_limits enable row level security;
revoke all on private.posting_limits from public, anon, authenticated;

-- An AFTER trigger, so the reader is first told what is really wrong (no
-- side, a closed discussion, a post too long: RLS and CHECKs run before it),
-- and a refused post rolls back with everything its insert did.
create function private.posts_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits private.posting_limits;
  v_account_created timestamptz;
  v_per_hour integer;
  v_last timestamptz;
  v_nth_latest timestamptz;
  v_wait integer;
  v_which text;
begin
  -- One author's posts are checked one at a time: a second insert waits
  -- here for the first to commit, then counts it.
  perform pg_advisory_xact_lock(hashtextextended('posts_rate_limit:' || new.author_id::text, 0));

  select l.* into v_limits
    from public.profiles p join private.posting_limits l on l.tier = p.tier
   where p.id = new.author_id;
  if not found then
    select l.* into strict v_limits from private.posting_limits l where l.tier = 'free';
  end if;
  select u.created_at into v_account_created from auth.users u where u.id = new.author_id;
  v_per_hour := case
    when v_account_created > now() - make_interval(hours => v_limits.new_account_hours)
    then v_limits.new_account_posts_per_hour
    else v_limits.posts_per_hour end;

  select max(p.created_at) into v_last
    from public.posts p where p.author_id = new.author_id and p.id <> new.id;
  -- The per_hour-th latest post: once it is an hour old, there is room.
  select p.created_at into v_nth_latest
    from public.posts p
   where p.author_id = new.author_id and p.id <> new.id
     and p.created_at > now() - interval '1 hour'
   order by p.created_at desc
  offset v_per_hour - 1 limit 1;

  if v_last is not null
     and v_last > now() - make_interval(secs => v_limits.seconds_between_posts) then
    v_which := 'spacing';
    v_wait := ceil(extract(epoch from
                v_last + make_interval(secs => v_limits.seconds_between_posts) - now()));
  end if;
  if v_nth_latest is not null then
    -- The longer wait wins: both limits must be met.
    if v_wait is null
       or extract(epoch from v_nth_latest + interval '1 hour' - now()) > v_wait then
      v_which := 'hourly';
      v_wait := ceil(extract(epoch from v_nth_latest + interval '1 hour' - now()));
    end if;
  end if;

  if v_wait is not null then
    -- PT429: PostgREST answers HTTP 429. The detail tells 4.5's composer
    -- how long to wait and which limit was met.
    raise exception 'Posting too fast: you can post again in % seconds.', greatest(v_wait, 1)
      using errcode = 'PT429',
            detail = json_build_object('retry_after_seconds', greatest(v_wait, 1),
                                       'limit', v_which,
                                       'posts_per_hour', v_per_hour)::text;
  end if;
  return null;
end;
$$;

revoke all on function private.posts_rate_limit() from public, anon, authenticated;

create trigger posts_rate_limit after insert on public.posts
  for each row execute function private.posts_rate_limit();
