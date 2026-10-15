-- Profiles (Prompt 4.1): handles, the community rules agreement, and account
-- deletion that actually deletes.
--
-- A profile is made by the first sign-in's required flow: the reader confirms
-- they are 17 or older, picks a handle, then presses "I agree" on the rules.
-- Until rules_accepted_at is set the account is not finished (posting checks
-- it in 4.2).
--
-- Clients never write this table directly. There is no INSERT or UPDATE
-- grant; the flow goes through the functions below, which take the user from
-- auth.uid() and never as an argument. So tier, strikes and trust_level can
-- never be self-written, and nobody can act for someone else.
--
-- Public fields are id, handle and display_name: readable signed out too, so
-- handles can show on posts to anonymous readers. Everything else is the
-- account's own, read back through my_profile().

-- ---------------------------------------------------------------------------
-- Handles: 3-20 characters, lower-case letters, digits and _, starting with a
-- letter, and not reserved. src/core/handles.ts holds the same rules for
-- instant feedback; tests/handles-sql.test.ts keeps the two in step.
-- ---------------------------------------------------------------------------
create function public.handle_reserved(p_handle text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_handle = any (array[
           'admin', 'administrator', 'anonymous', 'deleted', 'everyone', 'expert',
           'help', 'mod', 'mods', 'moderator', 'moderators', 'null', 'root',
           'security', 'system', 'undefined', 'unverified', 'verified'
         ])
      or p_handle ~ ('^(' || array_to_string(array[
           'admin', 'agora', 'global_agora', 'globalagora', 'moderator', 'official',
           'staff', 'support', 'team_'
         ], '|') || ')');
$$;

revoke all on function public.handle_reserved(text) from public, anon, authenticated;

alter table public.profiles
  add constraint profiles_handle_shape check (handle ~ '^[a-z][a-z0-9_]{2,19}$'),
  add constraint profiles_handle_not_reserved check (not public.handle_reserved(handle));

-- ---------------------------------------------------------------------------
-- Reading: public fields for everyone, by column. A client asking for any
-- other column (or select *) is refused.
-- ---------------------------------------------------------------------------
revoke select on public.profiles from authenticated;
grant select (id, handle, display_name) on public.profiles to anon, authenticated;

drop policy "profiles: read your own" on public.profiles;

create policy "profiles: public fields"
  on public.profiles for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- The first sign-in's flow.
-- ---------------------------------------------------------------------------

-- Which of up to ten candidate handles could be claimed now: valid, not
-- reserved and not taken. The flow checks its suggestions and what the reader
-- types. Definer, so handle_reserved stays closed to clients.
create function public.handles_available(p_handles text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c.handle order by c.ord), '{}')
    from unnest(p_handles[1:10]) with ordinality as c(handle, ord)
   where c.handle ~ '^[a-z][a-z0-9_]{2,19}$'
     and not public.handle_reserved(c.handle)
     and not exists (select 1 from public.profiles p where p.handle = c.handle);
$$;

-- Creates the caller's profile with a handle, or changes the handle while the
-- rules are not yet agreed (the flow's Back button). The 17+ confirmation is
-- an argument so it is recorded as an explicit answer, not assumed.
--
-- Errors: 22023 for an invalid or reserved handle or a missing 17+
-- confirmation, 23505 (profiles_handle_key) for a taken handle, 55000 once the
-- rules are agreed (a handle is then for keeps).
create function public.claim_handle(p_handle text, p_is_adult boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if p_is_adult is not true then
    raise exception 'Global Agora accounts are for people 17 and older' using errcode = '22023';
  end if;
  if p_handle is null or p_handle !~ '^[a-z][a-z0-9_]{2,19}$' then
    raise exception 'a handle is 3-20 lower-case letters, digits or _, starting with a letter'
      using errcode = '22023';
  end if;
  if public.handle_reserved(p_handle) then
    raise exception 'that handle is reserved' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles
              where id = v_user and rules_accepted_at is not null) then
    raise exception 'the handle is already set' using errcode = '55000';
  end if;

  insert into public.profiles (id, handle, is_adult)
  values (v_user, p_handle, true)
  on conflict (id) do update set handle = excluded.handle, is_adult = true;
  return p_handle;
end;
$$;

-- The rules screen's "I agree". The time is the database's, never the
-- client's. Calling it again (when the rules change) records the new time.
create function public.accept_rules()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  update public.profiles set rules_accepted_at = now()
   where id = auth.uid()
  returning rules_accepted_at into v_at;
  if v_at is null then
    raise exception 'choose a handle first' using errcode = '55000';
  end if;
  return v_at;
end;
$$;

-- The caller's own profile, private fields included. No row: not set up yet.
create function public.my_profile()
returns table (
  handle            text,
  display_name      text,
  is_adult          boolean,
  rules_accepted_at timestamptz,
  tier              text,
  created_at        timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.handle, p.display_name, p.is_adult, p.rules_accepted_at, p.tier, p.created_at
    from public.profiles p
   where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Account deletion that actually deletes (Prompt 4.1). Deleting the auth user
-- cascades to the profile, follows and saved stories, and through the profile
-- to posts, votes and blocks; Supabase Auth's own identities and sessions go
-- with it. Reports keep their row with the reporter set to null, so the
-- moderation record survives (20260924100200_discussions.sql).
--
-- Only ever the caller: there is no argument to point it at anyone else.
-- ---------------------------------------------------------------------------
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  delete from auth.users where id = v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Signed-in readers only. Functions are closed by default (the ingest
-- migration); these grants open exactly these five.
-- ---------------------------------------------------------------------------
revoke all on function
  public.handles_available(text[]),
  public.claim_handle(text, boolean),
  public.accept_rules(),
  public.my_profile(),
  public.delete_my_account()
from public, anon, authenticated;

grant execute on function
  public.handles_available(text[]),
  public.claim_handle(text, boolean),
  public.accept_rules(),
  public.my_profile(),
  public.delete_my_account()
to authenticated;
