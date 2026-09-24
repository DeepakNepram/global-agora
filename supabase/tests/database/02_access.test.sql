-- Access: what anon and signed-in users can actually read and write, row by row.
--
-- Fixture ids: users ...0a (reader A) and ...0b (reader B), story ...51,
-- posts ...e1 (A, approved), ...e2 (B, pending), ...e3 (A, hidden).
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- Fixtures, written as the table owner (as the ingest Worker's service role would).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'reader-a@test.example'),
  ('00000000-0000-4000-8000-00000000000b', 'reader-b@test.example');
insert into public.profiles (id, handle) values
  ('00000000-0000-4000-8000-00000000000a', 'reader_a'),
  ('00000000-0000-4000-8000-00000000000b', 'reader_b');
insert into public.stories (id, title, category, lat, lon, published_at) values
  ('00000000-0000-4000-8000-000000000051', 'Fixture story', 0, 41.01, 28.97, now());
insert into public.articles (story_id, url, headline) values
  ('00000000-0000-4000-8000-000000000051', 'https://fixture.example/a', 'Fixture headline');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label, closes_at) values
  ('00000000-0000-4000-8000-000000000051', 'Fixture prompt?', 'Yes', 'No', now() + interval '48 hours');
insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000051',
   '00000000-0000-4000-8000-00000000000a', 'approved post by a', 'a', 'argument', 'ok'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-000000000051',
   '00000000-0000-4000-8000-00000000000b', 'pending post by b', 'b', 'argument', 'pending'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-000000000051',
   '00000000-0000-4000-8000-00000000000a', 'hidden post by a', 'a', 'argument', 'hidden');
insert into public.votes (post_id, voter_id, kind, voter_stance) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', 'helpful', 'a'),
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000b', 'helpful', 'b');
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a');
insert into public.reports (post_id, reporter_id, reason) values
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-00000000000a', 'spam');
insert into public.feature_flags (key, enabled) values ('fixture.flag', true);

-- ---------------------------------------------------------------------------
-- Signed out: stories and articles only (Prompt 2.1), and nothing writable.
-- ---------------------------------------------------------------------------
set local role anon;

select ok(exists (select 1 from public.stories where id = '00000000-0000-4000-8000-000000000051'),
  'anon reads stories');
select ok(exists (select 1 from public.articles where story_id = '00000000-0000-4000-8000-000000000051'),
  'anon reads articles');

select throws_ok('select 1 from public.profiles',      '42501', null, 'anon cannot read profiles');
select throws_ok('select 1 from public.feature_flags', '42501', null, 'anon cannot read feature_flags');
select throws_ok('select 1 from public.discussions',   '42501', null, 'anon cannot read discussions');
select throws_ok('select 1 from public.posts',         '42501', null, 'anon cannot read posts');
select throws_ok('select 1 from public.votes',         '42501', null, 'anon cannot read votes');
select throws_ok('select 1 from public.reports',       '42501', null, 'anon cannot read reports');
select throws_ok('select 1 from public.blocks',        '42501', null, 'anon cannot read blocks');

select throws_ok(
  $$insert into public.stories (title, category, lat, lon, published_at) values ('x', 0, 0, 0, now())$$,
  '42501', null, 'anon cannot insert stories');
select throws_ok('update public.stories set heat = 255', '42501', null, 'anon cannot update stories');
select throws_ok('delete from public.articles', '42501', null, 'anon cannot delete articles');

reset role;

-- ---------------------------------------------------------------------------
-- Signed in as reader A.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);

select ok(exists (select 1 from public.stories where id = '00000000-0000-4000-8000-000000000051'),
  'signed in: reads stories');
select ok(exists (select 1 from public.articles where story_id = '00000000-0000-4000-8000-000000000051'),
  'signed in: reads articles');
select ok(exists (select 1 from public.discussions where story_id = '00000000-0000-4000-8000-000000000051'),
  'signed in: reads discussions');
select ok(exists (select 1 from public.feature_flags where key = 'fixture.flag'),
  'signed in: reads feature flags');

select is((select array_agg(id) from public.profiles),
  array['00000000-0000-4000-8000-00000000000a']::uuid[],
  'signed in: reads only their own profile');
select is((select array_agg(body order by body) from public.posts),
  array['approved post by a', 'hidden post by a'],
  'signed in: reads approved posts plus their own in any state, not others'' pending ones');
select is((select array_agg(voter_id) from public.votes),
  array['00000000-0000-4000-8000-00000000000a']::uuid[],
  'signed in: reads only their own votes');
select is((select array_agg(blocked_id) from public.blocks),
  array['00000000-0000-4000-8000-00000000000b']::uuid[],
  'signed in: reads only the blocks they made');
select throws_ok('select 1 from public.reports', '42501', null, 'signed in: cannot read reports');

-- No client writes until Prompts 4.1-4.3 add them with their own checks.
select throws_ok(
  $$insert into public.posts (story_id, author_id, body, stance, kind)
    values ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-00000000000a', 'hi', 'a', 'argument')$$,
  '42501', null, 'signed in: cannot post yet');
select throws_ok($$update public.profiles set tier = 'pro'$$, '42501', null,
  'signed in: cannot change their own tier');
select throws_ok(
  $$insert into public.votes (post_id, voter_id, kind)
    values ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-00000000000a', 'helpful')$$,
  '42501', null, 'signed in: cannot vote yet');
select throws_ok(
  $$insert into public.reports (post_id, reporter_id, reason)
    values ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-00000000000a', 'spam')$$,
  '42501', null, 'signed in: cannot report yet');
select throws_ok('delete from public.blocks', '42501', null, 'signed in: cannot remove blocks yet');
select throws_ok(
  $$insert into public.stories (title, category, lat, lon, published_at) values ('x', 0, 0, 0, now())$$,
  '42501', null, 'signed in: cannot insert stories');
select throws_ok('delete from public.discussions', '42501', null, 'signed in: cannot delete discussions');
select throws_ok($$update public.feature_flags set enabled = false$$, '42501', null,
  'signed in: cannot flip feature flags');

-- ---------------------------------------------------------------------------
-- Signed in as reader B: sees A's approved post, never A's hidden one.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);

select is((select array_agg(body order by body) from public.posts),
  array['approved post by a', 'pending post by b'],
  'another reader sees approved posts and their own, never someone else''s hidden post');

reset role;

select * from finish();
rollback;
