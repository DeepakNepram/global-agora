-- The moderation queue (Prompt 4.3) for admins: hidden posts, reported
-- posts, and posts the models never answered for, with approve / remove /
-- strike. Prompt 4.6 puts it in the admin console at /admin and reuses the
-- role check, private.is_admin(), in its own policies.
--
-- Admins are rows in public.admins, added by SQL (docs/DECISIONS.md); no
-- client can grant the role.

create table public.admins (
  -- Cascade: deleting an account takes its role with it (Prompt 4.1).
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  granted_at timestamptz not null default now()
);

alter table public.admins enable row level security;

create policy "admins: service role only"
  on public.admins as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

revoke all on function private.is_admin() from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;

-- What moderators did, and when: Prompt 4.6 counts from this and from
-- reports.resolved_at. Automatic decisions are on the post itself
-- (mod_scores, moderated_at).
create table public.moderation_actions (
  id         bigint generated always as identity primary key,
  post_id    uuid references public.posts (id) on delete set null,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null check (action in ('approve', 'remove', 'strike')),
  created_at timestamptz not null default now()
);

create index moderation_actions_created_idx on public.moderation_actions (created_at);

alter table public.moderation_actions enable row level security;

create policy "moderation actions: service role only"
  on public.moderation_actions as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- The queue, longest waiting first:
-- - hidden: the toxicity check held it for a human;
-- - reported: approved and visible, with open reports;
-- - unchecked: pending, and out of retries (a model or the function kept
--   failing) or never sent, so a human decides instead.
-- ---------------------------------------------------------------------------
create function public.moderation_queue(p_limit integer default 100)
returns table (
  post_id           uuid,
  story_id          uuid,
  prompt            text,
  side_label        text,
  body              text,
  kind              text,
  stance            text,
  evidence_url      text,
  created_at        timestamptz,
  author_id         uuid,
  author_handle     text,
  author_strikes    smallint,
  author_suspended  boolean,
  -- How many strikes suspend, so a strike can say whether it will.
  strikes_to_suspend smallint,
  mod_state         text,
  queued_for        text,
  waiting_since     timestamptz,
  report_count      integer,
  report_reasons    jsonb,
  toxicity          real,
  flagged           text[],
  mod_scores        jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'p_limit must be 1 to 500, got %', p_limit using errcode = '22023';
  end if;

  return query
  with reason_counts as (
    select r.post_id, r.reason, count(*)::integer as n, min(r.created_at) as first_at
      from public.reports r
     where r.state = 'open'
     group by r.post_id, r.reason
  ), open_reports as (
    select c.post_id, sum(c.n)::integer as n, min(c.first_at) as first_at,
           jsonb_object_agg(c.reason, c.n) as reasons
      from reason_counts c
     group by c.post_id
  ), queued as (
    select p.*,
           case when p.mod_state = 'hidden' then 'hidden'
                when p.mod_state = 'pending' then 'unchecked'
                else 'reported' end as queued_for,
           case when p.mod_state = 'hidden' then coalesce(p.moderated_at, p.created_at)
                when p.mod_state = 'pending' then p.created_at
                else o.first_at end as waiting_since,
           o.n, o.reasons
      from public.posts p
      left join open_reports o on o.post_id = p.id
     where p.mod_state = 'hidden'
        or (p.mod_state = 'ok' and o.post_id is not null)
        or (p.mod_state = 'pending'
            and exists (select 1 from private.moderation_settings m
                         where p.mod_attempts >= m.max_attempts
                            -- never sent (no Vault entries): as long as the
                            -- retries would have taken
                            or p.created_at <= now() - m.retry_after * (m.max_attempts + 1)))
  )
  select q.id, q.story_id, d.prompt,
         case q.stance when 'a' then d.side_a_label when 'b' then d.side_b_label
                       else 'Neutral' end,
         q.body, q.kind, q.stance, q.evidence_url, q.created_at,
         q.author_id, a.handle, a.strikes, a.suspended_at is not null,
         (select m.strikes_to_suspend from private.moderation_settings m),
         q.mod_state, q.queued_for, q.waiting_since,
         coalesce(q.n, 0), coalesce(q.reasons, '{}'::jsonb),
         (q.mod_scores -> 'signals' ->> 'toxicity')::real,
         coalesce(array(select jsonb_array_elements_text(q.mod_scores -> 'signals' -> 'flagged')),
                  '{}'::text[]),
         q.mod_scores
    from queued q
    join public.discussions d on d.story_id = q.story_id
    join public.profiles a on a.id = q.author_id
   order by q.waiting_since, q.id
   limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- A moderator's decision on a queued post:
-- - approve: published (or kept), its reports dismissed;
-- - remove: removed, its reports actioned;
-- - strike: removed, its reports actioned, and its author's strike (one per
--   post; three suspend, 20261017100000).
-- Every reporter hears the outcome; the author hears of a removal.
-- ---------------------------------------------------------------------------
create function public.moderate_post(p_post uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_post public.posts;
  v_state text;
begin
  if not private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('approve', 'remove', 'strike') then
    raise exception 'action must be approve, remove or strike' using errcode = '22023';
  end if;
  select * into v_post from public.posts p where p.id = p_post for update;
  if not found then
    raise exception 'no such post' using errcode = 'P0002';
  end if;
  if v_post.mod_state = 'removed' then
    raise exception 'already removed' using errcode = '55000';
  end if;

  v_state := case when p_action = 'approve' then 'ok' else 'removed' end;
  update public.posts p
     set mod_state = v_state, moderated_at = now()
   where p.id = p_post;
  if v_state = 'removed' then
    perform private.post_removed(p_post, p_action = 'strike', 'moderator', v_uid, '{}');
  end if;

  with resolved as (
    update public.reports r
       set state = case when p_action = 'approve' then 'dismissed' else 'actioned' end,
           resolved_at = now(),
           resolved_by = v_uid
     where r.post_id = p_post and r.state = 'open'
    returning r.reporter_id
  )
  insert into public.notifications (user_id, kind, post_id, story_id, detail)
  select distinct r.reporter_id, 'report_outcome', p_post, v_post.story_id,
         jsonb_build_object('outcome', case when p_action = 'approve' then 'kept' else 'removed' end)
    from resolved r
   where r.reporter_id is not null;

  insert into public.moderation_actions (post_id, actor_id, action) values (p_post, v_uid, p_action);
  return v_state;
end;
$$;

revoke all on function public.moderation_queue(integer) from public, anon, authenticated;
revoke all on function public.moderate_post(uuid, text) from public, anon, authenticated;
-- Signed-in callers; the functions refuse anyone who is not an admin.
grant execute on function public.moderation_queue(integer) to authenticated;
grant execute on function public.moderate_post(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- my_profile: the account's strikes and suspension (the account sheet says
-- where they stand), and whether it moderates (the sheet links the queue).
-- ---------------------------------------------------------------------------
drop function public.my_profile();
create function public.my_profile()
returns table (
  handle            text,
  display_name      text,
  is_adult          boolean,
  rules_accepted_at timestamptz,
  tier              text,
  created_at        timestamptz,
  strikes           smallint,
  suspended_at      timestamptz,
  is_admin          boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.handle, p.display_name, p.is_adult, p.rules_accepted_at, p.tier, p.created_at,
         p.strikes, p.suspended_at,
         exists (select 1 from public.admins a where a.user_id = p.id)
    from public.profiles p
   where p.id = auth.uid();
$$;

revoke all on function public.my_profile() from public, anon, authenticated;
grant execute on function public.my_profile() to authenticated;
