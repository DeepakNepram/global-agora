-- Scheduled jobs (pg_cron): closing discussions 48 hours after they open
-- (Prompt 4.2), and two clean-ups that would otherwise grow forever.
--
-- pg_cron ships in Supabase's Postgres, locally and on hosted projects (free
-- plan included); creating it here is what enabling it in the dashboard does.
-- Jobs run as the role that scheduled them (postgres), so each calls one
-- SECURITY DEFINER function in private, which no client role may execute.

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Closing. Posting and voting already stop at closes_at (the access policies,
-- 20261016110000), so this only turns the discussion's state, and its story's,
-- to closed: the Discuss button and the payload's disc flag follow within the
-- job's five minutes.
-- ---------------------------------------------------------------------------
create function private.close_due_discussions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed integer;
begin
  with closed as (
    update public.discussions d
       set state = 'closed'
     where d.state = 'open' and d.closes_at <= now()
    returning d.story_id
  ), marked as (
    update public.stories s
       set discussion_state = 'closed'
      from closed c
     where s.id = c.story_id
    returning s.id
  )
  select count(*) into v_closed from closed;
  return v_closed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Abandoned sign-ups (Prompt 4.1). A reader who leaves the first sign-in's
-- setup is signed out with an auth user but no profile: an email address and
-- nothing else. After a week without signing in, it goes. Finishing setup
-- makes a profile, so no account in use is touched.
-- ---------------------------------------------------------------------------
create function private.forget_abandoned_signups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from auth.users u
   where coalesce(u.last_sign_in_at, u.created_at) < now() - interval '7 days'
     and not exists (select 1 from public.profiles p where p.id = u.id);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- pg_cron logs every run in cron.job_run_details and never clears it: the
-- close job alone adds 288 rows a day. A week is enough to see what failed.
-- ---------------------------------------------------------------------------
create function private.prune_cron_history()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from cron.job_run_details d where d.end_time < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function
  private.close_due_discussions(),
  private.forget_abandoned_signups(),
  private.prune_cron_history()
from public, anon, authenticated;

-- By name, so re-running this (db reset) replaces rather than duplicates.
select cron.schedule('close-discussions', '*/5 * * * *',
                     'select private.close_due_discussions()');
select cron.schedule('forget-abandoned-signups', '17 3 * * *',
                     'select private.forget_abandoned_signups()');
select cron.schedule('prune-cron-history', '23 3 * * *',
                     'select private.prune_cron_history()');
