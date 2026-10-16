-- The moderation queue (Prompt 4.3): who may use it, what it holds, and
-- what approve / remove / strike do. Run with `npm run db:test`. Rolls back.
--
-- Fixture ids:
--   7a1 M (an admin), 7a2 A (the author), 7a3 R1 and 7a4 R2 (reporters),
--   7a5 P (a reader)
--   discussion on story 7b1; posts 7c1..7c9 by A:
--     7c1 hidden, 7c2 reported twice, 7c3 pending out of retries,
--     7c4 pending and recent, 7c5 approved, 7c6 removed, 7c7 pending and
--     never sent, 7c8 and 7c9 reported once
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- Fixtures write several posts per author at once (limits: 15_posting_limits),
-- and no post here is handed to the function (13_moderation covers that).
update private.posting_limits
   set posts_per_hour = 1000, seconds_between_posts = 0, new_account_posts_per_hour = 1000;
delete from vault.secrets where name in ('moderation_function_url', 'moderation_hook_secret');

insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000007a' || n)::uuid, 'queue-' || n || '@test.example'
  from generate_series(1, 5) n;
insert into public.profiles (id, handle, is_adult, rules_accepted_at)
select ('00000000-0000-4000-8000-0000000007a' || n)::uuid, 'queue_' || n, true, now()
  from generate_series(1, 5) n;
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000007a1');
insert into public.stories (id, title, category, lat, lon, published_at, discussion_state) values
  ('00000000-0000-4000-8000-0000000007b1', 'Queued debate', 0, 41.01, 28.97, now(), 'open');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label) values
  ('00000000-0000-4000-8000-0000000007b1', 'Queued?', 'Yes', 'No');

insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state, mod_attempts,
                          mod_scores, moderated_at, created_at)
select ('00000000-0000-4000-8000-0000000007c' || n)::uuid, '00000000-0000-4000-8000-0000000007b1',
       '00000000-0000-4000-8000-0000000007a2', 'post ' || n, 'a', 'argument', state, attempts,
       scores, moderated, now() - make_interval(mins => age)
  from (values
    (1, 'hidden', 1, '{"signals": {"flagged": [], "toxicity": 0.7}}'::jsonb,
     now() - interval '10 minutes', 15),
    (2, 'ok', 1, null, null, 40),
    (3, 'pending', 5, null, null, 20),
    (4, 'pending', 1, null, null, 1),
    (5, 'ok', 1, null, null, 40),
    (6, 'removed', 1, null, null, 40),
    (7, 'pending', 0, null, null, 30),
    (8, 'ok', 1, null, null, 40),
    (9, 'ok', 1, null, null, 40)
  ) v(n, state, attempts, scores, moderated, age);
insert into public.reports (post_id, reporter_id, reason, created_at) values
  ('00000000-0000-4000-8000-0000000007c2', '00000000-0000-4000-8000-0000000007a3', 'harassment',
   now() - interval '5 minutes'),
  ('00000000-0000-4000-8000-0000000007c2', '00000000-0000-4000-8000-0000000007a4', 'spam',
   now() - interval '3 minutes'),
  ('00000000-0000-4000-8000-0000000007c8', '00000000-0000-4000-8000-0000000007a3', 'threat',
   now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-0000000007c9', '00000000-0000-4000-8000-0000000007a3', 'spam',
   now() - interval '1 minute');

-- ---------------------------------------------------------------------------
-- Admins only.
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok('select * from public.moderation_queue()', '42501', null, 'guests cannot see the queue');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000007a5", "role": "authenticated"}', true);
select throws_ok('select * from public.moderation_queue()', '42501', 'moderators only',
  'a reader cannot see the queue');
select throws_ok($$select public.moderate_post('00000000-0000-4000-8000-0000000007c2', 'remove')$$,
  '42501', 'moderators only', 'or act on it');
select is(private.is_admin(), false, 'a reader is not an admin');
select is((select is_admin from public.my_profile()), false, 'and my_profile says so');
select throws_ok('select * from public.admins', '42501', null, 'nobody reads who the admins are');
select throws_ok($$insert into public.admins (user_id)
                   values ('00000000-0000-4000-8000-0000000007a5')$$,
  '42501', null, 'or makes themselves one');
select throws_ok('select * from public.moderation_actions', '42501', null,
  'nor reads the moderation log');

-- ---------------------------------------------------------------------------
-- What the queue holds.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000007a1", "role": "authenticated"}', true);
select is(private.is_admin(), true, 'M is an admin');
select is((select is_admin from public.my_profile()), true, 'and my_profile says so');
select results_eq(
  $$select right(post_id::text, 3), queued_for from public.moderation_queue()$$,
  $$values ('7c7'::text, 'unchecked'::text), ('7c3', 'unchecked'), ('7c1', 'hidden'),
           ('7c2', 'reported'), ('7c8', 'reported'), ('7c9', 'reported')$$,
  'hidden, reported and unchecked posts, longest waiting first');
select results_eq(
  $$select report_count, report_reasons, side_label, author_handle, author_strikes,
           author_suspended, strikes_to_suspend, prompt
      from public.moderation_queue() where post_id = '00000000-0000-4000-8000-0000000007c2'$$,
  $$values (2, '{"harassment": 1, "spam": 1}'::jsonb, 'Yes'::text, 'queue_2'::text, 0::smallint,
            false, 3::smallint, 'Queued?'::text)$$,
  'a reported post shows its reasons, its side and its author');
select results_eq(
  $$select toxicity, flagged from public.moderation_queue()
     where post_id = '00000000-0000-4000-8000-0000000007c1'$$,
  $$values (0.7::real, '{}'::text[])$$,
  'a hidden post shows why it was held');
select is((select count(*) from public.moderation_queue(2)), 2::bigint, 'the limit holds');
select throws_ok('select * from public.moderation_queue(0)', '22023', null,
  'and must be 1 to 500');

-- ---------------------------------------------------------------------------
-- The three actions.
-- ---------------------------------------------------------------------------
select is(public.moderate_post('00000000-0000-4000-8000-0000000007c1', 'approve'), 'ok',
  'approving a hidden post publishes it');
select is(public.moderate_post('00000000-0000-4000-8000-0000000007c2', 'approve'), 'ok',
  'approving a reported post keeps it');
select is(public.moderate_post('00000000-0000-4000-8000-0000000007c9', 'remove'), 'removed',
  'remove removes');
select is(public.moderate_post('00000000-0000-4000-8000-0000000007c8', 'strike'), 'removed',
  'strike removes too');
select throws_ok($$select public.moderate_post('00000000-0000-4000-8000-0000000007c8', 'strike')$$,
  '55000', null, 'a removed post cannot be struck again');
select throws_ok($$select public.moderate_post('00000000-0000-4000-8000-0000000007c5', 'ban')$$,
  '22023', null, 'only the three actions');
select throws_ok($$select public.moderate_post('00000000-0000-4000-8000-0000000000ff', 'remove')$$,
  'P0002', null, 'only a post that exists');
select results_eq(
  $$select right(post_id::text, 3) from public.moderation_queue()$$,
  $$values ('7c7'::text), ('7c3')$$,
  'what was decided leaves the queue');
select is(public.moderate_post('00000000-0000-4000-8000-0000000007c3', 'approve'), 'ok',
  'an unchecked post can be approved by hand');
reset role;

select results_eq(
  $$select right(id::text, 3), mod_state from public.posts
     where id::text like '00000000-0000-4000-8000-0000000007c_' order by id$$,
  $$values ('7c1'::text, 'ok'::text), ('7c2', 'ok'), ('7c3', 'ok'), ('7c4', 'pending'),
           ('7c5', 'ok'), ('7c6', 'removed'), ('7c7', 'pending'), ('7c8', 'removed'),
           ('7c9', 'removed')$$,
  'each post holds its decision');
set local role service_role;
select is(public.record_moderation('00000000-0000-4000-8000-0000000007c3',
                                   '{"signals": {"flagged": ["hate"], "toxicity": 0.99}}'),
  'ok', 'a model answering late cannot overturn a moderator');
reset role;
select is((select post_count from public.discussions
            where story_id = '00000000-0000-4000-8000-0000000007b1'),
  4, 'the approved count follows each decision (7c1, 7c3 joined; 7c8, 7c9 left)');
select results_eq(
  $$select right(post_id::text, 3), source, issued_by from public.strikes
     where user_id = '00000000-0000-4000-8000-0000000007a2'$$,
  $$values ('7c8'::text, 'moderator'::text, '00000000-0000-4000-8000-0000000007a1'::uuid)$$,
  'strike gave the author one strike, issued by M; remove gave none');
select results_eq(
  $$select right(post_id::text, 3), state, resolved_by from public.reports
     where post_id::text like '00000000-0000-4000-8000-0000000007c_' order by post_id, reason$$,
  $$values ('7c2'::text, 'dismissed'::text, '00000000-0000-4000-8000-0000000007a1'::uuid),
           ('7c2', 'dismissed', '00000000-0000-4000-8000-0000000007a1'),
           ('7c8', 'actioned', '00000000-0000-4000-8000-0000000007a1'),
           ('7c9', 'actioned', '00000000-0000-4000-8000-0000000007a1')$$,
  'reports are dismissed or actioned, by M');
select is((select count(*) from public.reports
            where resolved_at is null and post_id::text like '00000000-0000-4000-8000-0000000007c_'),
  0::bigint,
  'each with when it was dealt with');
select results_eq(
  $$select right(post_id::text, 3), action, actor_id from public.moderation_actions
     where actor_id = '00000000-0000-4000-8000-0000000007a1' order by id$$,
  $$values ('7c1'::text, 'approve'::text, '00000000-0000-4000-8000-0000000007a1'::uuid),
           ('7c2', 'approve', '00000000-0000-4000-8000-0000000007a1'),
           ('7c9', 'remove', '00000000-0000-4000-8000-0000000007a1'),
           ('7c8', 'strike', '00000000-0000-4000-8000-0000000007a1'),
           ('7c3', 'approve', '00000000-0000-4000-8000-0000000007a1')$$,
  'every action is logged');

-- ---------------------------------------------------------------------------
-- Who is told what.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000007a3", "role": "authenticated"}', true);
select results_eq(
  $$select right(post_id::text, 3), kind, detail ->> 'outcome' from public.notifications
     order by post_id$$,
  $$values ('7c2'::text, 'report_outcome'::text, 'kept'::text),
           ('7c8', 'report_outcome', 'removed'),
           ('7c9', 'report_outcome', 'removed')$$,
  'R1 hears the outcome of each report');
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000007a4", "role": "authenticated"}', true);
select results_eq(
  $$select right(post_id::text, 3), detail ->> 'outcome' from public.notifications$$,
  $$values ('7c2'::text, 'kept'::text)$$,
  'R2 hears theirs');
select is((select count(*) from public.notifications where detail ? 'source'), 0::bigint,
  'a reporter is told the outcome, nothing about the author');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000007a2", "role": "authenticated"}', true);
select results_eq(
  $$select right(post_id::text, 3), kind, detail ->> 'source', detail ->> 'strike',
           detail ->> 'strikes'
      from public.notifications order by post_id$$,
  $$values ('7c8'::text, 'post_removed'::text, 'moderator'::text, 'true'::text, '1'::text),
           ('7c9', 'post_removed', 'moderator', 'false', '0')$$,
  'the author hears of each removal, and of the strike');
select is((select count(*) from public.notifications where kind = 'report_outcome'), 0::bigint,
  'not who reported them');
select results_eq(
  $$select strikes, suspended_at is null, is_admin from public.my_profile()$$,
  $$values (1::smallint, true, false)$$,
  'my_profile shows the author their strikes and that they are not suspended');
reset role;

-- ---------------------------------------------------------------------------
-- The grants.
-- ---------------------------------------------------------------------------
select is(has_function_privilege('anon', 'public.moderation_queue(integer)', 'execute'), false,
  'guests cannot call the queue');
select is(has_function_privilege('anon', 'public.moderate_post(uuid, text)', 'execute'), false,
  'or the actions');
select is(has_function_privilege('authenticated', 'private.is_admin()', 'execute'), true,
  '4.6''s policies can ask whether the caller is an admin');

select * from finish();
rollback;
