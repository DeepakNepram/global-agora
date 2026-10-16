-- Moderation (Prompt 4.3): what happens to a post once the models have
-- scored it, and to its author.
--
-- A post is inserted pending (4.2), which only its author can see. A trigger
-- hands it to the moderate-post Edge Function through pg_net; the function
-- asks OpenAI's moderation model and Google's text moderation, and gives the
-- scores back to record_moderation(), which decides here, with thresholds
-- from a settings row rather than literals (the owner tunes them):
-- - any OpenAI category flagged, or Google's Toxic confidence above the
--   removal line: removed, never publicly visible, and a strike;
-- - Toxic confidence from the hide line up to the removal line: hidden,
--   visible to its author only, queued for a human;
-- - otherwise ok.
-- Self-harm flags remove without a strike (the owner's call): the author's
-- notice points to help instead.
--
-- Fail closed: no Vault entries, a model down or a function error all leave
-- the post pending. A sweep retries; after the last try a human sees it in
-- the moderation queue (20261017130000).

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Settings: one row. Tune with `update private.moderation_settings set ...`.
-- ---------------------------------------------------------------------------
create table private.moderation_settings (
  id                    boolean primary key default true check (id),
  -- Google's Toxic confidence, 0 to 1 (Perspective's toxicity, which has gone).
  toxicity_hide_at      real not null default 0.65 check (toxicity_hide_at between 0 and 1),
  toxicity_remove_above real not null default 0.85 check (toxicity_remove_above between 0 and 1),
  -- OpenAI categories that remove a post without a strike.
  no_strike_categories  text[] not null
                          default array['self-harm', 'self-harm/intent', 'self-harm/instructions'],
  strikes_to_suspend    smallint not null default 3 check (strikes_to_suspend >= 1),
  -- Requests to the function per post before a human has to look.
  max_attempts          smallint not null default 5 check (max_attempts between 1 and 50),
  retry_after           interval not null default interval '2 minutes'
                          check (retry_after > interval '0'),
  constraint moderation_settings_bands check (toxicity_hide_at <= toxicity_remove_above)
);

insert into private.moderation_settings default values;

alter table private.moderation_settings enable row level security;
revoke all on private.moderation_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The decision. Signals are what the Edge Function reads from the two
-- models: {"flagged": [OpenAI categories], "toxicity": Google's Toxic}.
-- ---------------------------------------------------------------------------
create function private.moderation_verdict(
  p_signals jsonb,
  out state text,
  out strike boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings private.moderation_settings;
  v_flagged text[];
  v_toxicity real;
begin
  if jsonb_typeof(p_signals -> 'flagged') is distinct from 'array'
     or jsonb_typeof(p_signals -> 'toxicity') is distinct from 'number' then
    raise exception 'signals need a flagged array and a toxicity number' using errcode = '22023';
  end if;
  v_flagged := array(select jsonb_array_elements_text(p_signals -> 'flagged'));
  v_toxicity := (p_signals ->> 'toxicity')::real;
  if v_toxicity not between 0 and 1 then
    raise exception 'toxicity must be 0 to 1, got %', v_toxicity using errcode = '22023';
  end if;

  select * into strict v_settings from private.moderation_settings;
  if cardinality(v_flagged) > 0 or v_toxicity > v_settings.toxicity_remove_above then
    state := 'removed';
    strike := v_toxicity > v_settings.toxicity_remove_above
              or not (v_flagged <@ v_settings.no_strike_categories);
  elsif v_toxicity >= v_settings.toxicity_hide_at then
    state := 'hidden';
    strike := false;
  else
    state := 'ok';
    strike := false;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Strikes and suspension.
-- ---------------------------------------------------------------------------
alter table public.profiles add column suspended_at timestamptz;

create table public.strikes (
  id         uuid primary key default gen_random_uuid(),
  -- Cascade: deleting an account deletes everything about it (Prompt 4.1).
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- One strike per post at most, however it was removed.
  post_id    uuid unique references public.posts (id) on delete set null,
  source     text not null check (source in ('auto', 'moderator')),
  issued_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index strikes_user_idx on public.strikes (user_id);

alter table public.strikes enable row level security;

-- An account's strike count reaches its owner through my_profile(); the
-- rows themselves are for moderators (Prompt 4.6), through the service role.
create policy "strikes: service role only"
  on public.strikes as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);

-- profiles.strikes is the count; reaching the setting suspends. Deleting a
-- strike (by hand, in SQL) recounts but does not lift a suspension: that is
-- a separate, deliberate update of suspended_at.
create function private.strikes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  update public.profiles p
     set strikes = least((select count(*) from public.strikes s where s.user_id = v_user), 32767),
         suspended_at = case
           when tg_op = 'INSERT' and p.suspended_at is null
            and (select count(*) from public.strikes s where s.user_id = v_user)
                >= (select m.strikes_to_suspend from private.moderation_settings m)
           then now()
           else p.suspended_at end
   where p.id = v_user;
  return null;
end;
$$;

create trigger strikes_count after insert or delete on public.strikes
  for each row execute function private.strikes_count();

-- Taking part (posting, voting, taking a side) needs agreed rules and no
-- suspension. Every 4.2 policy calls this, so a suspension holds at once.
create or replace function private.can_take_part()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.rules_accepted_at is not null and p.suspended_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- Notifications: in the app, to their owner only.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('report_outcome', 'post_removed')),
  post_id    uuid references public.posts (id) on delete set null,
  story_id   uuid references public.discussions (story_id) on delete set null,
  detail     jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "notifications: read your own"
  on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "notifications: mark your own read"
  on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- A removed post's consequences: the strike (unless spared), and the
-- author's notice saying what happened and where they now stand.
-- ---------------------------------------------------------------------------
create function private.post_removed(
  p_post uuid,
  p_strike boolean,
  p_source text,
  p_actor uuid,
  p_flagged text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
  v_struck boolean := false;
  v_profile public.profiles;
begin
  select * into strict v_post from public.posts where id = p_post;
  if p_strike then
    insert into public.strikes (user_id, post_id, source, issued_by)
    values (v_post.author_id, p_post, p_source, p_actor)
    on conflict (post_id) do nothing;
    v_struck := found;
  end if;
  select * into strict v_profile from public.profiles where id = v_post.author_id;
  insert into public.notifications (user_id, kind, post_id, story_id, detail)
  values (v_post.author_id, 'post_removed', p_post, v_post.story_id,
          jsonb_build_object(
            'source', p_source,
            'flagged', to_jsonb(coalesce(p_flagged, '{}'::text[])),
            'strike', v_struck,
            'strikes', v_profile.strikes,
            'strikes_to_suspend', (select m.strikes_to_suspend from private.moderation_settings m),
            'suspended', v_profile.suspended_at is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- The function's answer. Service role only: the Edge Function calls it with
-- the scores, and the decision and its consequences happen here, atomically.
-- ---------------------------------------------------------------------------
alter table public.posts
  add column mod_attempts     smallint not null default 0 check (mod_attempts >= 0),
  add column mod_requested_at timestamptz,
  add column moderated_at     timestamptz;

-- The retry sweep's work list.
create index posts_pending_idx on public.posts (created_at) where mod_state = 'pending';

create function public.record_moderation(p_post uuid, p_scores jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_verdict record;
begin
  if jsonb_typeof(p_scores) is distinct from 'object' then
    raise exception 'scores must be an object' using errcode = '22023';
  end if;
  select p.mod_state into v_state from public.posts p where p.id = p_post for update;
  if not found then
    return 'gone';
  end if;
  -- Decided already (a retry crossed with a late answer, or a moderator got
  -- there first): the first decision stands.
  if v_state <> 'pending' then
    return v_state;
  end if;

  select * into v_verdict from private.moderation_verdict(p_scores -> 'signals');
  update public.posts
     set mod_scores = p_scores || jsonb_build_object('checked_at', now()),
         mod_state = v_verdict.state,
         moderated_at = now()
   where id = p_post;
  if v_verdict.state = 'removed' then
    perform private.post_removed(
      p_post, v_verdict.strike, 'auto', null,
      array(select jsonb_array_elements_text(p_scores -> 'signals' -> 'flagged')));
  end if;
  return v_verdict.state;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sending a post to the function. The URL and the hook secret live in
-- Supabase Vault (set per project; locally by supabase/seeds), never here.
-- pg_net queues the request in this transaction and sends it after commit.
-- ---------------------------------------------------------------------------
create function private.request_moderation(p_post uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_body text;
begin
  select s.decrypted_secret into v_url
    from vault.decrypted_secrets s where s.name = 'moderation_function_url';
  select s.decrypted_secret into v_secret
    from vault.decrypted_secrets s where s.name = 'moderation_hook_secret';
  if v_url is null or v_secret is null then
    return false;  -- not configured: the post waits, pending
  end if;
  select p.body into v_body from public.posts p where p.id = p_post and p.mod_state = 'pending';
  if not found then
    return false;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('post_id', p_post, 'body', v_body),
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-moderation-secret', v_secret),
    -- Two models in parallel, each given 8 s by the function.
    timeout_milliseconds := 20000);
  update public.posts
     set mod_attempts = least(mod_attempts + 1, 32767), mod_requested_at = now()
   where id = p_post;
  return true;
end;
$$;

create function private.posts_request_moderation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.request_moderation(new.id);
  return null;
end;
$$;

create trigger posts_request_moderation after insert on public.posts
  for each row when (new.mod_state = 'pending')
  execute function private.posts_request_moderation();

-- Posts still pending after retry_after are asked about again, up to
-- max_attempts; then they wait for a human in the moderation queue.
create function private.retry_moderation()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post uuid;
  v_sent integer := 0;
begin
  for v_post in
    select p.id
      from public.posts p, private.moderation_settings m
     where p.mod_state = 'pending'
       and p.mod_attempts < m.max_attempts
       and coalesce(p.mod_requested_at, p.created_at) <= now() - m.retry_after
     order by p.created_at
     limit 100
  loop
    if private.request_moderation(v_post) then
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end;
$$;

revoke all on function
  private.moderation_verdict(jsonb),
  private.strikes_count(),
  private.post_removed(uuid, boolean, text, uuid, text[]),
  private.request_moderation(uuid),
  private.posts_request_moderation(),
  private.retry_moderation()
from public, anon, authenticated;

revoke all on function public.record_moderation(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_moderation(uuid, jsonb) to service_role;

select cron.schedule('retry-moderation', '* * * * *', 'select private.retry_moderation()');
