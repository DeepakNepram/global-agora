-- Scheduled jobs (pg_cron): closing discussions 48 hours after opening
-- (Prompt 4.2), forgetting abandoned sign-ups (4.1), pruning the run log.
-- The jobs' functions are called directly here; pg_cron's own timing is
-- checked by hand (docs/DECISIONS.md). Run with `npm run db:test`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select has_extension('pg_cron', 'pg_cron is installed');
select results_eq(
  'select jobname::text, schedule::text, command::text from cron.job order by jobname',
  $$values ('close-discussions'::text, '*/5 * * * *'::text, 'select private.close_due_discussions()'::text),
           ('forget-abandoned-signups', '17 3 * * *', 'select private.forget_abandoned_signups()'),
           ('prune-cron-history', '23 3 * * *', 'select private.prune_cron_history()')$$,
  'three jobs, each calling one function'
);

-- ---------------------------------------------------------------------------
-- Closing.
-- ---------------------------------------------------------------------------
insert into public.stories (id, title, category, lat, lon, published_at, discussion_state) values
  ('00000000-0000-4000-8000-0000000003a1', 'Due', 0, 41.01, 28.97, now(), 'open'),
  ('00000000-0000-4000-8000-0000000003a2', 'Not yet', 0, 48.85, 2.35, now(), 'open');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label, opened_at, closes_at) values
  ('00000000-0000-4000-8000-0000000003a1', 'Due?', 'Yes', 'No',
   now() - interval '49 hours', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000003a2', 'Not yet?', 'Yes', 'No', now(), default);

select is((select closes_at - opened_at from public.discussions
            where story_id = '00000000-0000-4000-8000-0000000003a2'),
  interval '48 hours', 'a new discussion closes 48 hours after it opens by default');
select is(private.close_due_discussions(), 1, 'the close job closes the one that is due');
select results_eq($$select d.state, s.discussion_state from public.discussions d
                     join public.stories s on s.id = d.story_id
                    where d.story_id = '00000000-0000-4000-8000-0000000003a1'$$,
  $$values ('closed'::text, 'closed'::text)$$,
  'the discussion and its story are closed (the payload''s disc flag follows)');
select results_eq($$select d.state, s.discussion_state from public.discussions d
                     join public.stories s on s.id = d.story_id
                    where d.story_id = '00000000-0000-4000-8000-0000000003a2'$$,
  $$values ('open'::text, 'open'::text)$$,
  'one with time left stays open');
select is(private.close_due_discussions(), 0, 'running it again changes nothing');

-- ---------------------------------------------------------------------------
-- Abandoned sign-ups: no profile and no sign-in for a week.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, created_at, last_sign_in_at) values
  ('00000000-0000-4000-8000-0000000003b1', 'abandoned@test.example', now() - interval '8 days', null),
  ('00000000-0000-4000-8000-0000000003b2', 'fresh@test.example', now() - interval '1 day', null),
  ('00000000-0000-4000-8000-0000000003b3', 'returning@test.example', now() - interval '30 days',
   now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000003b4', 'member@test.example', now() - interval '30 days',
   now() - interval '20 days');
insert into public.profiles (id, handle, is_adult, rules_accepted_at) values
  ('00000000-0000-4000-8000-0000000003b4', 'long_member', true, now() - interval '30 days');

select is(private.forget_abandoned_signups(), 1, 'one abandoned sign-up goes');
select is((select array_agg(email::text order by email) from auth.users
            where id::text like '00000000-0000-4000-8000-0000000003b_'),
  array['fresh@test.example', 'member@test.example', 'returning@test.example'],
  'a recent one stays, one that signed in this week stays, and an account with a profile stays');

-- ---------------------------------------------------------------------------
-- The run log keeps a week.
-- ---------------------------------------------------------------------------
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status,
                                  return_message, start_time, end_time)
values ((select jobid from cron.job where jobname = 'close-discussions'), -1, 0, 'postgres',
        'postgres', 'old run', 'succeeded', '', now() - interval '8 days', now() - interval '8 days'),
       ((select jobid from cron.job where jobname = 'close-discussions'), -2, 0, 'postgres',
        'postgres', 'recent run', 'succeeded', '', now() - interval '1 day', now() - interval '1 day');
select is(private.prune_cron_history(), 1, 'the prune removes runs older than a week');
select is((select count(*) from cron.job_run_details where runid in (-1, -2)), 1::bigint,
  'and keeps the recent one');

-- ---------------------------------------------------------------------------
-- Nobody but the scheduler runs these.
-- ---------------------------------------------------------------------------
set local role authenticated;
select throws_ok('select private.close_due_discussions()', '42501', null,
  'a client cannot close discussions');
select throws_ok('select private.forget_abandoned_signups()', '42501', null,
  'or delete accounts');
select throws_ok('select private.prune_cron_history()', '42501', null, 'or prune the run log');
reset role;

select * from finish();
rollback;
