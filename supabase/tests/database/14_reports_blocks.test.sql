-- Reports and blocks (Prompt 4.3). Run with `npm run db:test`. Rolls back.
--
-- Fixture ids:
--   readers 5a1 (A), 5a2 (B), 5a3 (C); 5a4 signed up without a profile
--   discussions on stories 5b1 (open) and 5b2 (closed)
--   posts: 5c1 A approved, 5c2 A hidden, 5c3 B approved, 5c4 A approved in
--   the closed debate, 5c5 C approved
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000005a1', 'rb-a@test.example'),
  ('00000000-0000-4000-8000-0000000005a2', 'rb-b@test.example'),
  ('00000000-0000-4000-8000-0000000005a3', 'rb-c@test.example'),
  ('00000000-0000-4000-8000-0000000005a4', 'rb-d@test.example');
insert into public.profiles (id, handle, is_adult, rules_accepted_at) values
  ('00000000-0000-4000-8000-0000000005a1', 'rb_a', true, now()),
  ('00000000-0000-4000-8000-0000000005a2', 'rb_b', true, now()),
  ('00000000-0000-4000-8000-0000000005a3', 'rb_c', true, now());
insert into public.stories (id, title, category, lat, lon, published_at, discussion_state) values
  ('00000000-0000-4000-8000-0000000005b1', 'Reported debate', 0, 41.01, 28.97, now(), 'open'),
  ('00000000-0000-4000-8000-0000000005b2', 'Closed debate', 0, 48.85, 2.35, now(), 'closed');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label, opened_at, closes_at, state)
values
  ('00000000-0000-4000-8000-0000000005b1', 'Reported?', 'Yes', 'No', now(), now() + interval '1 day',
   'open'),
  ('00000000-0000-4000-8000-0000000005b2', 'Closed?', 'Yes', 'No', now() - interval '3 days',
   now() - interval '1 day', 'closed');
insert into public.discussion_stances (story_id, user_id, stance) values
  ('00000000-0000-4000-8000-0000000005b1', '00000000-0000-4000-8000-0000000005a3', 'b');
insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state) values
  ('00000000-0000-4000-8000-0000000005c1', '00000000-0000-4000-8000-0000000005b1',
   '00000000-0000-4000-8000-0000000005a1', 'a says', 'a', 'argument', 'ok'),
  ('00000000-0000-4000-8000-0000000005c2', '00000000-0000-4000-8000-0000000005b1',
   '00000000-0000-4000-8000-0000000005a1', 'a hidden', 'a', 'argument', 'hidden'),
  ('00000000-0000-4000-8000-0000000005c3', '00000000-0000-4000-8000-0000000005b1',
   '00000000-0000-4000-8000-0000000005a2', 'b says', 'b', 'argument', 'ok'),
  ('00000000-0000-4000-8000-0000000005c4', '00000000-0000-4000-8000-0000000005b2',
   '00000000-0000-4000-8000-0000000005a1', 'a said, before the close', 'a', 'expert', 'ok'),
  ('00000000-0000-4000-8000-0000000005c5', '00000000-0000-4000-8000-0000000005b1',
   '00000000-0000-4000-8000-0000000005a3', 'c says', 'b', 'argument', 'ok');

-- ---------------------------------------------------------------------------
-- Reports.
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select public.report_post('00000000-0000-4000-8000-0000000005c1', 'spam')$$,
  '42501', null, 'guests cannot report');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000005a2", "role": "authenticated"}', true);
select lives_ok($$select public.report_post('00000000-0000-4000-8000-0000000005c1', 'harassment')$$,
  'B reports A''s post for harassment');
select throws_ok($$select public.report_post('00000000-0000-4000-8000-0000000005c1', 'spam')$$,
  '23505', null, 'once per reader and post');
select throws_ok($$select public.report_post('00000000-0000-4000-8000-0000000005c5', 'rude')$$,
  '23514', null, 'only the six reasons');
select throws_ok($$select public.report_post('00000000-0000-4000-8000-0000000005c3', 'spam')$$,
  'P0002', null, 'not your own post');
select throws_ok($$select public.report_post('00000000-0000-4000-8000-0000000005c2', 'spam')$$,
  'P0002', null, 'not a post you cannot see (hidden)');
select throws_ok($$select public.report_post('00000000-0000-4000-8000-0000000000ff', 'spam')$$,
  'P0002', null, 'not a post that does not exist');
select lives_ok(
  $$select public.report_post('00000000-0000-4000-8000-0000000005c4', 'false_expertise')$$,
  'a closed debate''s posts can still be reported');
select lives_ok($$select public.report_post('00000000-0000-4000-8000-0000000005c5', 'off_topic')$$,
  'off topic is a reason');
select throws_ok('select * from public.reports', '42501', null,
  'a reporter cannot read reports, their own included');
select throws_ok($$insert into public.reports (post_id, reason)
                   values ('00000000-0000-4000-8000-0000000005c3', 'spam')$$,
  '42501', null, 'or write one except through report_post');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000005a4", "role": "authenticated"}', true);
select throws_ok($$select public.report_post('00000000-0000-4000-8000-0000000005c1', 'spam')$$,
  '42501', null, 'an account without a profile cannot report');
reset role;

select results_eq(
  $$select post_id, reporter_id, reason, state from public.reports
     where reporter_id = '00000000-0000-4000-8000-0000000005a2' order by reason$$,
  $$values ('00000000-0000-4000-8000-0000000005c4'::uuid, '00000000-0000-4000-8000-0000000005a2'::uuid,
            'false_expertise'::text, 'open'::text),
           ('00000000-0000-4000-8000-0000000005c1', '00000000-0000-4000-8000-0000000005a2',
            'harassment', 'open'),
           ('00000000-0000-4000-8000-0000000005c5', '00000000-0000-4000-8000-0000000005a2',
            'off_topic', 'open')$$,
  'the reports are recorded, open, for moderators');

-- ---------------------------------------------------------------------------
-- Blocks: A blocks C, and each disappears for the other.
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$insert into public.blocks (blocked_id)
                   values ('00000000-0000-4000-8000-0000000005a3')$$,
  '42501', null, 'guests cannot block');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}', true);
select lives_ok($$insert into public.blocks (blocked_id)
                  values ('00000000-0000-4000-8000-0000000005a3')$$,
  'A blocks C');
select throws_ok($$insert into public.blocks (blocker_id, blocked_id)
                   values ('00000000-0000-4000-8000-0000000005a2',
                           '00000000-0000-4000-8000-0000000005a3')$$,
  '42501', null, 'A cannot block on B''s behalf');
select throws_ok($$insert into public.blocks (blocked_id)
                   values ('00000000-0000-4000-8000-0000000005a1')$$,
  '23514', null, 'nobody blocks themselves');
select results_eq('select blocker_id, blocked_id from public.blocks',
  $$values ('00000000-0000-4000-8000-0000000005a1'::uuid, '00000000-0000-4000-8000-0000000005a3'::uuid)$$,
  'A sees their block');
select is((select array_agg(body order by body) from public.posts
            where story_id = '00000000-0000-4000-8000-0000000005b1'),
  array['a hidden', 'a says', 'b says'], 'A no longer sees C''s post');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000005a3", "role": "authenticated"}', true);
select is((select count(*) from public.blocks), 0::bigint, 'C does not see who blocked them');
select is((select array_agg(body order by body) from public.posts
            where story_id = '00000000-0000-4000-8000-0000000005b1'),
  array['b says', 'c says'], 'and C no longer sees A''s posts: both directions');
select throws_ok($$insert into public.votes (post_id, kind)
                   values ('00000000-0000-4000-8000-0000000005c1', 'helpful')$$,
  '42501', null, 'C cannot vote on A''s post');
select throws_ok($$select public.report_post('00000000-0000-4000-8000-0000000005c1', 'spam')$$,
  'P0002', null, 'or report it');
delete from public.blocks;
reset role;
select is((select count(*) from public.blocks), 1::bigint, 'C cannot lift A''s block');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000005a2", "role": "authenticated"}', true);
select is((select array_agg(body order by body) from public.posts
            where story_id = '00000000-0000-4000-8000-0000000005b1'),
  array['a says', 'b says', 'c says'], 'B, uninvolved, sees both');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000005a1", "role": "authenticated"}', true);
select lives_ok($$delete from public.blocks where blocked_id = '00000000-0000-4000-8000-0000000005a3'$$,
  'A unblocks C');
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000005a3", "role": "authenticated"}', true);
select is((select count(*) from public.posts where author_id = '00000000-0000-4000-8000-0000000005a1'),
  2::bigint, 'and C sees A''s approved posts again');
select lives_ok($$insert into public.votes (post_id, kind)
                  values ('00000000-0000-4000-8000-0000000005c1', 'helpful')$$,
  'and can vote on them');
reset role;

-- ---------------------------------------------------------------------------
-- A profile is needed; agreed rules and a clean record are not.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000005a4", "role": "authenticated"}', true);
select throws_ok($$insert into public.blocks (blocked_id)
                   values ('00000000-0000-4000-8000-0000000005a1')$$,
  '23503', null, 'an account without a profile cannot block');
reset role;

update public.profiles set suspended_at = now(), rules_accepted_at = null
 where id = '00000000-0000-4000-8000-0000000005a3';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000005a3", "role": "authenticated"}', true);
select lives_ok($$insert into public.blocks (blocked_id)
                  values ('00000000-0000-4000-8000-0000000005a2')$$,
  'a suspended reader can still block');
select lives_ok($$select public.report_post('00000000-0000-4000-8000-0000000005c1', 'threat')$$,
  'and report');
reset role;

-- ---------------------------------------------------------------------------
-- What clients may do, and nothing more.
-- ---------------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'private.blocked_either_way()', 'execute'), true,
  'the posts policy can ask who is blocked');
select set_config('request.jwt.claims', '', true);
select is((select count(*) from private.blocked_either_way()), 0::bigint,
  'and without a caller, nobody is');
select column_privs_are('public', 'blocks', 'blocker_id', 'authenticated', array['SELECT'],
  'the blocker is always the caller (no grant)');
select column_privs_are('public', 'blocks', 'blocked_id', 'authenticated', array['INSERT', 'SELECT'],
  'a client names only whom to block');
select table_privs_are('public', 'blocks', 'authenticated', array['DELETE', 'SELECT'],
  'and may unblock (RLS: own)');
select is(has_function_privilege('anon', 'public.report_post(uuid, text)', 'execute'), false,
  'report_post is for signed-in readers');

select * from finish();
rollback;
