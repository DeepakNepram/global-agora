-- The admin console (Prompt 4.6): who may use it, the hot story queue, what
-- the debate suggestion is written from, opening a discussion under the cap,
-- the counters, and correcting a location. Run with `npm run db:test`.
-- Rolls back.
--
-- Fixture ids:
--   9a1 M (an admin), 9a2 R (a reader), 9a3 A (an author)
--   stories: 9f1 queued, heat 200, nine outlets; 9f2 queued, heat 150,
--     3 location reports; 9f3 not queued, heat 250, 5 location reports;
--     9f4 open, closing in an hour; 9f5 queued, heat 100;
--     9f6 open but past its close time; 9f7 not queued, placed by the ingest
--   posts by A on 9f4: 1, 3 and 30 hours old
--   reports: 2 open; 3 resolved this week after 60, 120 and 600 seconds;
--     1 resolved 10 days ago
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

update private.posting_limits
   set posts_per_hour = 1000, seconds_between_posts = 0, new_account_posts_per_hour = 1000;
delete from vault.secrets where name in ('moderation_function_url', 'moderation_hook_secret');

insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000009a' || n)::uuid, 'console-' || n || '@test.example'
  from generate_series(1, 3) n;
insert into public.profiles (id, handle, is_adult, rules_accepted_at)
select ('00000000-0000-4000-8000-0000000009a' || n)::uuid, 'console_' || n, true, now()
  from generate_series(1, 3) n;
insert into public.admins (user_id) values ('00000000-0000-4000-8000-0000000009a1');

insert into public.stories (id, title, summary, category, lat, lon, place_name, place_source,
                            country_code, heat, published_at, discussion_state) values
  ('00000000-0000-4000-8000-0000000009f1', 'Hot queued story', 'What happened.', 0,
   48.86, 2.35, 'Paris', 'gdelt', 'FR', 200, now() - interval '2 hours', 'queued'),
  ('00000000-0000-4000-8000-0000000009f2', 'Warm queued story', null, 0,
   35.68, 139.69, 'Tokyo', 'gdelt', 'JP', 150, now() - interval '3 hours', 'queued'),
  ('00000000-0000-4000-8000-0000000009f3', 'Misplaced story', null, 0,
   12.97, -77.59, 'Somewhere', 'gdelt', 'PE', 250, now() - interval '1 hour', 'none'),
  ('00000000-0000-4000-8000-0000000009f4', 'Open story', null, 0,
   40.71, -74.01, 'New York', 'gdelt', 'US', 90, now() - interval '5 hours', 'open'),
  ('00000000-0000-4000-8000-0000000009f5', 'Mild queued story', null, 0,
   51.51, -0.13, 'London', 'gdelt', 'GB', 100, now() - interval '4 hours', 'queued'),
  ('00000000-0000-4000-8000-0000000009f6', 'Expired story', null, 0,
   52.52, 13.40, 'Berlin', 'gdelt', 'DE', 80, now() - interval '50 hours', 'open'),
  ('00000000-0000-4000-8000-0000000009f7', 'Ingest-placed story', null, 0,
   19.08, 72.88, 'Mumbai', 'gdelt', 'IN', 60, now() - interval '1 hour', 'none');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label, opened_at, closes_at)
values
  ('00000000-0000-4000-8000-0000000009f4', 'Open?', 'Yes', 'No',
   now() - interval '47 hours', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-0000000009f6', 'Expired?', 'Yes', 'No',
   now() - interval '50 hours', now() - interval '2 hours');

-- Nine outlets for 9f1, one of them twice.
insert into public.articles (story_id, url, outlet, headline, published_at)
select '00000000-0000-4000-8000-0000000009f1', 'https://news' || n || '.example/a', 'outlet ' || n,
       'Headline ' || n, now() - make_interval(mins => n)
  from generate_series(1, 9) n;
insert into public.articles (story_id, url, outlet, headline, published_at) values
  ('00000000-0000-4000-8000-0000000009f1', 'https://news1.example/b', 'outlet 1',
   'Older headline 1', now() - interval '3 hours');

insert into public.story_location_reports (story_id, reports, last_reported_at) values
  ('00000000-0000-4000-8000-0000000009f2', 3, now() - interval '10 minutes'),
  ('00000000-0000-4000-8000-0000000009f3', 5, now() - interval '20 minutes');

insert into public.discussion_stances (story_id, user_id, stance) values
  ('00000000-0000-4000-8000-0000000009f4', '00000000-0000-4000-8000-0000000009a3', 'a');
insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state, created_at)
select ('00000000-0000-4000-8000-0000000009c' || n)::uuid, '00000000-0000-4000-8000-0000000009f4',
       '00000000-0000-4000-8000-0000000009a3', 'post ' || n, 'a', 'argument', 'ok',
       now() - make_interval(hours => age)
  from (values (1, 1), (2, 3), (3, 30)) v(n, age);
-- One report per reader and post, so two readers across the three posts.
insert into public.reports (post_id, reporter_id, reason, state, created_at, resolved_at)
select ('00000000-0000-4000-8000-0000000009c' || post)::uuid,
       ('00000000-0000-4000-8000-0000000009a' || reporter)::uuid, 'spam',
       state, created, created + make_interval(secs => took)
  from (values
    (1, 2, 'open', now() - interval '1 hour', null),
    (1, 1, 'open', now() - interval '2 hours', null),
    (2, 2, 'actioned', now() - interval '1 day', 60),
    (2, 1, 'dismissed', now() - interval '2 days', 120),
    (3, 2, 'actioned', now() - interval '3 days', 600),
    (3, 1, 'actioned', now() - interval '10 days', 9999)
  ) v(post, reporter, state, created, took);

-- Its detail is when the next discussion closes; throws_ok cannot read it.
create function pg_temp.cap_refusal(p_story uuid) returns text language plpgsql as $$
declare
  v_detail text;
begin
  perform public.open_discussion(p_story, 'Capped?', 'Yes', 'No');
  return 'opened';
exception when sqlstate 'PT409' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;
grant execute on function pg_temp.cap_refusal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admins only.
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok('select * from public.admin_story_queue()', '42501', null,
  'guests cannot see the story queue');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000009a2", "role": "authenticated"}', true);
select throws_ok('select * from public.admin_story_queue()', '42501', 'moderators only',
  'a reader cannot see the story queue');
select throws_ok($$select public.admin_story_brief('00000000-0000-4000-8000-0000000009f1')$$,
  '42501', 'moderators only', 'or a story''s brief, so the suggestion function refuses them');
select throws_ok(
  $$select * from public.open_discussion('00000000-0000-4000-8000-0000000009f1', 'Q?', 'Y', 'N')$$,
  '42501', 'moderators only', 'or open a discussion');
select throws_ok('select * from public.admin_counters(now())', '42501', 'moderators only',
  'or read the counters');
select throws_ok('select * from public.admin_location_queue()', '42501', 'moderators only',
  'or the location queue');
select throws_ok(
  $$select public.fix_story_location('00000000-0000-4000-8000-0000000009f3', 0, 0, null, null)$$,
  '42501', 'moderators only', 'or move a pin');
select throws_ok('select * from public.admin_actions', '42501', null,
  'nobody reads the admin log');
select throws_ok($$insert into public.discussions (story_id, prompt, side_a_label, side_b_label, closes_at)
                   values ('00000000-0000-4000-8000-0000000009f1', 'Q?', 'Y', 'N', now() + interval '1 day')$$,
  '42501', null, 'and no client opens a discussion directly');

-- ---------------------------------------------------------------------------
-- The hot story queue and the brief.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000009a1", "role": "authenticated"}', true);
select results_eq(
  $$select right(story_id::text, 3), heat from public.admin_story_queue(500)
     where story_id::text like '00000000-0000-4000-8000-0000000009%'$$,
  $$values ('9f1'::text, 200::smallint), ('9f2', 150::smallint), ('9f5', 100::smallint)$$,
  'queued stories only, hottest first');
select results_eq(
  $$select title, place_name, country_code, source_count, location_reports
      from public.admin_story_queue(500)
     where story_id = '00000000-0000-4000-8000-0000000009f2'$$,
  $$values ('Warm queued story'::text, 'Tokyo'::text, 'JP'::text, 1::smallint, 3)$$,
  'each with its headline, place, sources and wrong-location reports');
select throws_ok('select * from public.admin_story_queue(0)', '22023', null,
  'the limit must be 1 to 500');
select is(
  public.admin_story_brief('00000000-0000-4000-8000-0000000009f1') - 'headlines' - 'published_at',
  '{"title": "Hot queued story", "summary": "What happened.", "place_name": "Paris",
    "country_code": "FR"}'::jsonb,
  'the brief has the headline, snippet and place');
select is(
  (select array_agg(h ->> 'headline')
     from jsonb_array_elements(
       public.admin_story_brief('00000000-0000-4000-8000-0000000009f1') -> 'headlines') h),
  array['Headline 1', 'Headline 2', 'Headline 3', 'Headline 4', 'Headline 5', 'Headline 6',
        'Headline 7', 'Headline 8'],
  'and eight outlets'' newest headlines, one per outlet');
select throws_ok($$select public.admin_story_brief('00000000-0000-4000-8000-0000000000ff')$$,
  'P0002', null, 'only for a story that exists');

-- ---------------------------------------------------------------------------
-- Opening.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select right(story_id::text, 3), closes_at, open_count, max_open
      from public.open_discussion('00000000-0000-4000-8000-0000000009f5',
                                  '  Should London do it?  ', ' Yes ', ' No ')$$,
  $$values ('9f5'::text, now() + interval '48 hours', 2, 25)$$,
  'a queued story opens for 48 hours; the expired discussion does not count');
select results_eq(
  $$select prompt, side_a_label, side_b_label, state from public.discussions
     where story_id = '00000000-0000-4000-8000-0000000009f5'$$,
  $$values ('Should London do it?'::text, 'Yes'::text, 'No'::text, 'open'::text)$$,
  'with its words trimmed');
select is(
  (select discussion_state from public.stories where id = '00000000-0000-4000-8000-0000000009f5'),
  'open', 'and its story says so');
select throws_ok(
  $$select * from public.open_discussion('00000000-0000-4000-8000-0000000009f5', 'Q?', 'Y', 'N')$$,
  '55000', 'this story''s discussion is already open', 'a story opens once');
select throws_ok(
  $$select * from public.open_discussion('00000000-0000-4000-8000-0000000009f3', 'Q?', 'Y', 'N')$$,
  '55000', 'this story is not in the queue', 'only from the queue');
select throws_ok(
  $$select * from public.open_discussion('00000000-0000-4000-8000-0000000000ff', 'Q?', 'Y', 'N')$$,
  'P0002', null, 'only a story that exists');
select throws_ok(
  format($$select * from public.open_discussion('00000000-0000-4000-8000-0000000009f1', %L, 'Y', 'N')$$,
         repeat('x', 201)),
  '22023', 'the prompt must be one line of 1 to 200 characters', 'the prompt fits the panel');
select throws_ok(
  $$select * from public.open_discussion('00000000-0000-4000-8000-0000000009f1', E'Two\nlines?', 'Y', 'N')$$,
  '22023', 'the prompt must be one line of 1 to 200 characters', 'on one line');
select throws_ok(
  format($$select * from public.open_discussion('00000000-0000-4000-8000-0000000009f1', 'Q?', %L, 'N')$$,
         repeat('y', 41)),
  '22023', 'each side must be one line of 1 to 40 characters', 'so does each side');
select throws_ok(
  $$select * from public.open_discussion('00000000-0000-4000-8000-0000000009f1', 'Q?', 'Yes', ' yes')$$,
  '22023', 'the two sides must differ', 'and the sides differ');
reset role;

-- The cap, at three: 9f4, 9f5, and one more.
update private.admin_settings set max_open_discussions = 3;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000009a1", "role": "authenticated"}', true);
select is(
  (select open_count from public.open_discussion('00000000-0000-4000-8000-0000000009f1',
                                                 'Should Paris?', 'Yes', 'No')),
  3, 'the third opens');
select throws_ok(
  $$select * from public.open_discussion('00000000-0000-4000-8000-0000000009f2', 'Q?', 'Y', 'N')$$,
  'PT409', '3 discussions are open, the most at once.', 'the fourth is refused at the cap');
select is(pg_temp.cap_refusal('00000000-0000-4000-8000-0000000009f2')::timestamptz,
  now() + interval '1 hour', 'and the refusal says when the next one closes');
reset role;
select is(
  (select discussion_state from public.stories where id = '00000000-0000-4000-8000-0000000009f2'),
  'queued', 'a refused story stays queued');
select results_eq(
  $$select right(story_id::text, 3), detail from public.admin_actions
     where action = 'open_discussion' and actor_id = '00000000-0000-4000-8000-0000000009a1'
     order by id$$,
  $$values ('9f5'::text, '{"prompt": "Should London do it?", "side_a": "Yes", "side_b": "No"}'::jsonb),
           ('9f1', '{"prompt": "Should Paris?", "side_a": "Yes", "side_b": "No"}'::jsonb)$$,
  'each opening is logged with its admin and words');
select throws_ok($$insert into public.discussions (story_id, prompt, side_a_label, side_b_label, closes_at)
                   values ('00000000-0000-4000-8000-0000000009f2', 'Q?', repeat('y', 41), 'N',
                           now() + interval '1 day')$$,
  '23514', null, 'the table holds the same limits');

-- ---------------------------------------------------------------------------
-- The counters.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000009a1", "role": "authenticated"}', true);
select results_eq(
  $$select open_discussions, max_open, next_close_at, reports_open, median_action_seconds,
           reports_resolved, median_window_days
      from public.admin_counters(now() - interval '2 hours')$$,
  $$values (3, 3, now() + interval '1 hour', 2, 120::double precision, 3, 7)$$,
  'open of the cap, the next close, open reports, and the median over the week');
select is((select posts_today from public.admin_counters(now() - interval '2 hours')), 1,
  'posts since the admin''s midnight');
select is((select posts_today from public.admin_counters(now() - interval '20 hours')), 2,
  'whenever that was');
select throws_ok($$select * from public.admin_counters(now() + interval '1 minute')$$, '22023',
  null, 'midnight is not in the future');
select throws_ok($$select * from public.admin_counters(now() - interval '27 hours')$$, '22023',
  null, 'nor more than a day ago');

-- ---------------------------------------------------------------------------
-- Correcting a location.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select right(story_id::text, 3), reports from public.admin_location_queue(500)
     where story_id::text like '00000000-0000-4000-8000-0000000009%'$$,
  $$values ('9f3'::text, 5), ('9f2', 3)$$,
  'reported stories, most reported first');
select results_eq(
  $$select right(q.story_id::text, 3), q.reports
      from public.stories s, public.admin_location_queue(50, s.seq) q
     where s.id = '00000000-0000-4000-8000-0000000009f5'$$,
  $$values ('9f5'::text, 0)$$,
  'or one story by its permalink''s number, reported or not');
select is(
  public.fix_story_location('00000000-0000-4000-8000-0000000009f3', 12.97, 77.59,
                            ' Bengaluru ', 'in'),
  5, 'moving a pin answers its reports');
select throws_ok(
  $$select public.fix_story_location('00000000-0000-4000-8000-0000000009f3', 91, 0, null, null)$$,
  '22023', null, 'the latitude must be on Earth');
select throws_ok(
  $$select public.fix_story_location('00000000-0000-4000-8000-0000000009f3', 'NaN', 0, null, null)$$,
  '22023', null, 'and a number');
select throws_ok(
  $$select public.fix_story_location('00000000-0000-4000-8000-0000000009f3', 0, 0, null, 'IND')$$,
  '22023', null, 'the country is two letters');
select throws_ok(
  $$select public.fix_story_location('00000000-0000-4000-8000-0000000000ff', 0, 0, null, null)$$,
  'P0002', null, 'only a story that exists');
reset role;

select results_eq(
  $$select lat, lon, place_name, country_code::text, place_source, place_conf
      from public.stories where id = '00000000-0000-4000-8000-0000000009f3'$$,
  $$values (12.97::double precision, 77.59::double precision, 'Bengaluru'::text, 'IN'::text,
            'manual'::text, 100::smallint)$$,
  'the story is where the admin put it, marked manual');
select is(
  (select count(*) from public.story_location_reports
    where story_id = '00000000-0000-4000-8000-0000000009f3'),
  0::bigint, 'its reports are gone');
select is(
  (select detail from public.admin_actions where action = 'fix_location'),
  '{"from": {"lat": 12.97, "lon": -77.59, "place_name": "Somewhere", "country_code": "PE",
             "place_source": "gdelt"},
    "to": {"lat": 12.97, "lon": 77.59, "place_name": "Bengaluru", "country_code": "IN"},
    "reports": 5}'::jsonb,
  'and the move is logged, from and to');

-- The next ingest batch moves an ingest-placed story but keeps a manual one.
select public.ingest_apply(jsonb_build_object(
  'slot', '2026-10-22T06:00:00Z',
  'stories', jsonb_agg(jsonb_build_object(
    'id', s.id, 'title', s.title, 'category', s.category, 'lat', 1.5, 'lon', 2.5,
    'place_name', 'Elsewhere', 'place_conf', 40, 'country_code', 'GH', 'heat', s.heat,
    'sentiment', 0, 'source_count', 1, 'published_at', s.published_at,
    'first_seen_at', s.first_seen_at, 'title_hash', null, 'discussion_state', 'none'))))
  from public.stories s
 where s.id in ('00000000-0000-4000-8000-0000000009f3', '00000000-0000-4000-8000-0000000009f7');
select results_eq(
  $$select right(id::text, 3), lat, place_name from public.stories
     where id in ('00000000-0000-4000-8000-0000000009f3', '00000000-0000-4000-8000-0000000009f7')
     order by id$$,
  $$values ('9f3'::text, 12.97::double precision, 'Bengaluru'::text),
           ('9f7', 1.5::double precision, 'Elsewhere'::text)$$,
  'the ingest keeps a corrected location');

select * from finish();
rollback;
