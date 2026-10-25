-- Appeals (Prompt 5.2): a suspended account asks a person to look again.
--
-- - A suspended account sends one appeal at a time, in its own words.
-- - A moderator grants or refuses it, with a reply. Granting ends the
--   suspension and overturns the strikes behind it: they stay on record for
--   moderators but no longer count. The removed posts stay removed.
-- - Refusing leaves the suspension; the account may appeal again after a wait
--   (a setting).
-- - Either way the account hears the outcome and the reply in its updates.
--
-- Clients never write appeals directly: submit_appeal and decide_appeal do,
-- and check who is asking.

-- ---------------------------------------------------------------------------
-- Strikes: overturned, not deleted, so the record stays.
-- ---------------------------------------------------------------------------
alter table public.strikes
  add column overturned_at timestamptz,
  add column overturned_by uuid references public.profiles (id) on delete set null;

-- Only standing strikes count, and still only a new strike suspends (an
-- overturn or a deletion never does). Replaces 20261017100000's.
create or replace function private.strikes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  v_standing integer;
begin
  select count(*) into v_standing
    from public.strikes s
   where s.user_id = v_user and s.overturned_at is null;
  update public.profiles p
     set strikes = least(v_standing, 32767),
         suspended_at = case
           when tg_op = 'INSERT' and p.suspended_at is null
            and v_standing >= (select m.strikes_to_suspend from private.moderation_settings m)
           then now()
           else p.suspended_at end
   where p.id = v_user;
  return null;
end;
$$;

drop trigger strikes_count on public.strikes;
create trigger strikes_count after insert or delete or update of overturned_at on public.strikes
  for each row execute function private.strikes_count();

-- ---------------------------------------------------------------------------
-- Settings: one row. Tune with `update private.appeal_settings set ...`.
-- ---------------------------------------------------------------------------
create table private.appeal_settings (
  id           boolean primary key default true check (id),
  -- After a refusal, how long before the account may appeal again.
  refusal_wait interval not null default interval '30 days'
                 check (refusal_wait >= interval '0')
);

insert into private.appeal_settings default values;

alter table private.appeal_settings enable row level security;
revoke all on private.appeal_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Appeals.
-- ---------------------------------------------------------------------------
create table public.appeals (
  id         uuid primary key default gen_random_uuid(),
  -- Cascade: deleting an account deletes everything about it (Prompt 4.1).
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- The same limit in the form (src/core/appeal.ts).
  body       text not null check (char_length(body) between 1 and 1000),
  status     text not null default 'pending' check (status in ('pending', 'granted', 'refused')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  reply      text check (char_length(reply) between 1 and 500),
  constraint appeals_decided check ((status = 'pending') = (decided_at is null)),
  constraint appeals_replied check ((status = 'pending') = (reply is null))
);

-- One waiting appeal per account.
create unique index appeals_one_pending on public.appeals (user_id) where status = 'pending';
create index appeals_user_idx on public.appeals (user_id, created_at desc);
create index appeals_pending_idx on public.appeals (created_at) where status = 'pending';

alter table public.appeals enable row level security;

grant select on public.appeals to authenticated;

create policy "appeals: read your own"
  on public.appeals for select to authenticated
  using ((select auth.uid()) = user_id);

-- The outcome reaches the account as an update, like a removal's notice.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('report_outcome', 'post_removed', 'appeal_outcome'));

-- And the decision is logged with the admin console's other actions.
alter table public.admin_actions drop constraint admin_actions_action_check;
alter table public.admin_actions add constraint admin_actions_action_check
  check (action in ('open_discussion', 'fix_location', 'grant_appeal', 'refuse_appeal'));

-- ---------------------------------------------------------------------------
-- Sending an appeal: only while suspended, one at a time, and not again
-- until the wait after a refusal is over.
-- ---------------------------------------------------------------------------
create function public.submit_appeal(p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(p_body);
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if v_body is null or char_length(v_body) not between 1 and 1000 then
    raise exception 'an appeal is 1 to 1000 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.suspended_at is not null) then
    raise exception 'only a suspended account can appeal' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.appeals a, private.appeal_settings s
     where a.user_id = v_uid and a.status = 'refused'
       and a.decided_at > now() - s.refusal_wait
  ) then
    raise exception 'too soon after a refusal' using errcode = '55000';
  end if;
  -- A second waiting appeal fails on appeals_one_pending (23505).
  insert into public.appeals (user_id, body) values (v_uid, v_body) returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- A moderator's decision, with a reply the account reads.
-- ---------------------------------------------------------------------------
create function public.decide_appeal(p_appeal uuid, p_grant boolean, p_reply text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reply text := btrim(p_reply);
  v_appeal public.appeals;
  v_status text := case when p_grant then 'granted' else 'refused' end;
begin
  if not private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  if p_grant is null or v_reply is null or char_length(v_reply) not between 1 and 500 then
    raise exception 'a decision and a reply of 1 to 500 characters' using errcode = '22023';
  end if;
  select * into v_appeal from public.appeals a where a.id = p_appeal for update;
  if not found then
    raise exception 'no such appeal' using errcode = 'P0002';
  end if;
  if v_appeal.status <> 'pending' then
    raise exception 'already decided' using errcode = '55000';
  end if;

  update public.appeals a
     set status = v_status, decided_at = now(), decided_by = v_uid, reply = v_reply
   where a.id = p_appeal;

  if p_grant then
    -- Overturning recounts (the trigger) without suspending again; then the
    -- suspension itself ends.
    update public.strikes s
       set overturned_at = now(), overturned_by = v_uid
     where s.user_id = v_appeal.user_id and s.overturned_at is null;
    update public.profiles p set suspended_at = null where p.id = v_appeal.user_id;
  end if;

  insert into public.notifications (user_id, kind, detail)
  values (v_appeal.user_id, 'appeal_outcome',
          jsonb_build_object('granted', p_grant, 'reply', v_reply));
  insert into public.admin_actions (actor_id, action, detail)
  values (v_uid, case when p_grant then 'grant_appeal' else 'refuse_appeal' end,
          jsonb_build_object('appeal', p_appeal, 'user', v_appeal.user_id));
  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- The moderators' list: waiting appeals first, oldest first, then the
-- latest decided. Each with the account's handle, strikes and the text of
-- the posts behind its standing strikes, to judge by.
-- ---------------------------------------------------------------------------
create function public.admin_appeals(p_limit integer default 50)
returns table (
  id            uuid,
  user_id       uuid,
  handle        text,
  body          text,
  status        text,
  created_at    timestamptz,
  decided_at    timestamptz,
  reply         text,
  strikes       smallint,
  suspended_at  timestamptz,
  removed_posts jsonb
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
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'p_limit must be 1 to 200, got %', p_limit using errcode = '22023';
  end if;
  return query
  select a.id, a.user_id, p.handle, a.body, a.status, a.created_at, a.decided_at, a.reply,
         p.strikes, p.suspended_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('body', po.body, 'created_at', po.created_at)
                            order by s.created_at desc)
             from public.strikes s
             join public.posts po on po.id = s.post_id
            where s.user_id = a.user_id and s.overturned_at is null
         ), '[]'::jsonb)
    from public.appeals a
    join public.profiles p on p.id = a.user_id
   order by (a.status = 'pending') desc,
            case when a.status = 'pending' then a.created_at end asc,
            a.decided_at desc
   limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- my_profile: and where the account's latest appeal stands, with when it may
-- appeal again after a refusal.
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
  is_admin          boolean,
  appeal_status     text,
  appeal_sent_at    timestamptz,
  appeal_reply      text,
  appeal_again_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.handle, p.display_name, p.is_adult, p.rules_accepted_at, p.tier, p.created_at,
         p.strikes, p.suspended_at,
         exists (select 1 from public.admins a where a.user_id = p.id),
         l.status, l.created_at, l.reply,
         case when l.status = 'refused' then l.decided_at + s.refusal_wait end
    from public.profiles p
    cross join private.appeal_settings s
    left join lateral (
      select a.status, a.created_at, a.reply, a.decided_at
        from public.appeals a
       where a.user_id = p.id
       order by a.created_at desc
       limit 1
    ) l on true
   where p.id = auth.uid();
$$;

revoke all on function public.my_profile() from public, anon, authenticated;
revoke all on function public.submit_appeal(text) from public, anon, authenticated;
revoke all on function public.decide_appeal(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_appeals(integer) from public, anon, authenticated;
-- Signed-in callers; each function checks who is asking.
grant execute on function public.my_profile() to authenticated;
grant execute on function public.submit_appeal(text) to authenticated;
grant execute on function public.decide_appeal(uuid, boolean, text) to authenticated;
grant execute on function public.admin_appeals(integer) to authenticated;
