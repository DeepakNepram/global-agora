-- Story UI (Prompt 3.3): the participant count api_story returns, and the
-- anonymous location report.
--
-- Fixture ids: users ...0c, ...0d, ...0e; story ...61 (open discussion),
-- ...62 (no discussion); posts ...f1-...f4.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000c', 'poster-c@test.example'),
  ('00000000-0000-4000-8000-00000000000d', 'poster-d@test.example'),
  ('00000000-0000-4000-8000-00000000000e', 'poster-e@test.example');
insert into public.profiles (id, handle) values
  ('00000000-0000-4000-8000-00000000000c', 'poster_c'),
  ('00000000-0000-4000-8000-00000000000d', 'poster_d'),
  ('00000000-0000-4000-8000-00000000000e', 'poster_e');
insert into public.stories (id, title, category, lat, lon, published_at, discussion_state) values
  ('00000000-0000-4000-8000-000000000061', 'Debated story', 0, 41.01, 28.97, now(), 'open'),
  ('00000000-0000-4000-8000-000000000062', 'Quiet story', 1, 35.68, 139.69, now(), 'none');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label, closes_at) values
  ('00000000-0000-4000-8000-000000000061', 'Fixture prompt?', 'Yes', 'No', now() + interval '48 hours');
-- c posts twice, d once, e only a hidden post: two participants.
insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000061',
   '00000000-0000-4000-8000-00000000000c', 'first by c', 'a', 'argument', 'ok'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-000000000061',
   '00000000-0000-4000-8000-00000000000c', 'second by c', 'a', 'argument', 'ok'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-000000000061',
   '00000000-0000-4000-8000-00000000000d', 'one by d', 'b', 'argument', 'ok'),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-000000000061',
   '00000000-0000-4000-8000-00000000000e', 'hidden by e', 'b', 'argument', 'hidden');

create temp table seqs on commit drop as
  select id, seq from public.stories where id::text like '00000000-0000-4000-8000-00000000006_';
grant select on seqs to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Participants, as a signed-out client sees them through api_story.
-- ---------------------------------------------------------------------------
set local role anon;
select is(
  (public.api_story(p_id => '00000000-0000-4000-8000-000000000061')->'discussion'->>'participants')::int,
  2,
  'participants count each visible author once, and not hidden posts');
select is(
  public.api_story(p_id => '00000000-0000-4000-8000-000000000062')->'discussion'->>'participants',
  null,
  'no discussion, no participant count');
select is(
  public.api_story(p_id => '00000000-0000-4000-8000-000000000061')->'discussion'->>'state',
  'open',
  'the discussion state is still there');
select is(public.discussion_participants('00000000-0000-4000-8000-000000000062'), 0,
  'a story without posts has no participants');
select throws_ok('select count(*) from public.posts', '42501', null,
  'the count does not open posts to anon');
reset role;

update public.stories set discussion_state = 'closed' where id = '00000000-0000-4000-8000-000000000061';
set local role anon;
select is(
  (public.api_story(p_id => '00000000-0000-4000-8000-000000000061')->'discussion'->>'participants')::int,
  2,
  'a closed discussion keeps its count');
reset role;

-- ---------------------------------------------------------------------------
-- Location reports, sent as a signed-out client.
-- ---------------------------------------------------------------------------
set local role anon;
select ok(public.api_report_location(p_seq => (select seq from seqs where id = '00000000-0000-4000-8000-000000000062')),
  'a report by seq is accepted');
select ok(public.api_report_location(p_id => '00000000-0000-4000-8000-000000000062'),
  'a report by UUID is accepted');
select ok(not public.api_report_location(p_seq => -1), 'an unknown story is refused');
select ok(not public.api_report_location(), 'no story at all is refused');
select throws_ok('select count(*) from public.story_location_reports', '42501', null,
  'anon cannot read the reports');
reset role;

select is((select reports from public.story_location_reports
            where story_id = '00000000-0000-4000-8000-000000000062'), 2,
  'two reports count two');

update public.story_location_reports set reports = 2147483647
 where story_id = '00000000-0000-4000-8000-000000000062';
set local role authenticated;
select lives_ok($$select public.api_report_location(p_id => '00000000-0000-4000-8000-000000000062')$$,
  'a saturated count does not overflow');
reset role;

delete from public.stories where id = '00000000-0000-4000-8000-000000000062';
select is((select count(*) from public.story_location_reports
            where story_id = '00000000-0000-4000-8000-000000000062'), 0::bigint,
  'reports go with their story');

select * from finish();
rollback;
