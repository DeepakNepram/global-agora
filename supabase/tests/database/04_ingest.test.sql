-- Ingest functions: service-only access, the slot lock, atomic and idempotent
-- writes, the guards on queued stories, candidate lookup, and retention that
-- spares stories with a discussion.
--
-- Fixture ids: stories ...71 and ...72 arrive through ingest_apply; ...73 (old,
-- with a discussion), ...74 (old) and ...75 (recent) are inserted directly.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- ---------------------------------------------------------------------------
-- Client roles see and call nothing.
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok('select 1 from public.story_signals', '42501', null, 'anon cannot read story_signals');
select throws_ok('select 1 from public.ingest_runs',   '42501', null, 'anon cannot read ingest_runs');
select throws_ok($$select public.ingest_apply('{}'::jsonb)$$, '42501', null, 'anon cannot call ingest_apply');
select throws_ok($$select public.ingest_claim(now())$$,       '42501', null, 'anon cannot call ingest_claim');
reset role;

set local role authenticated;
select throws_ok('select 1 from public.story_signals', '42501', null, 'signed in cannot read story_signals');
select throws_ok('select 1 from public.ingest_runs',   '42501', null, 'signed in cannot read ingest_runs');
select throws_ok($$select public.ingest_prune(now(), now())$$, '42501', null,
  'signed in cannot call ingest_prune');
select throws_ok($$select * from public.ingest_known_urls(array['https://a.example'])$$, '42501', null,
  'signed in cannot call ingest_known_urls');
reset role;

-- The Worker's role can call every ingest function.
select ok(has_function_privilege('service_role', 'public.ingest_apply(jsonb)', 'execute'),
  'service role can call ingest_apply');

-- ---------------------------------------------------------------------------
-- The slot lock.
-- ---------------------------------------------------------------------------
select ok(public.ingest_claim('2026-09-24 08:45:00+00'), 'a new slot can be claimed');
select ok(not public.ingest_claim('2026-09-24 08:45:00+00'), 'a running slot cannot be claimed twice');
select is(public.ingest_finish('2026-09-24 08:45:00+00', 'failed', null, 'boom'), 'failed',
  'a failed slot is recorded as failed');
select ok(public.ingest_claim('2026-09-24 08:45:00+00'), 'a failed slot can be claimed again');
select is((select attempts from public.ingest_runs where slot = '2026-09-24 08:45:00+00'), 2::smallint,
  'the retry counts as a second attempt');

update public.ingest_runs set started_at = now() - interval '11 minutes'
 where slot = '2026-09-24 08:45:00+00';
select ok(public.ingest_claim('2026-09-24 08:45:00+00'), 'a claim stuck in running for 10 minutes is taken over');
select is(public.ingest_finish('2026-09-24 08:45:00+00', 'failed', null, 'boom again'), 'skipped',
  'the third failure skips the slot, so the cursor moves on');
select throws_ok($$select public.ingest_finish(now(), 'done')$$, 'P0001', null,
  'only ingest_apply marks a slot done');

-- ---------------------------------------------------------------------------
-- ingest_apply writes a batch atomically, and replaying it changes nothing.
-- ---------------------------------------------------------------------------
create temporary table batch as select $json${
  "slot": "2026-09-24T09:00:00Z",
  "counts": {"rows": 3},
  "stories": [
    {"id": "00000000-0000-4000-8000-000000000071", "title": "Judge blocks media ban",
     "category": 2, "lat": 38.8977, "lon": -77.0365, "place_name": "White House, District of Columbia",
     "place_conf": 80, "country_code": "US", "heat": 120, "sentiment": -15, "source_count": 2,
     "published_at": "2026-09-24T08:10:00Z", "first_seen_at": "2026-09-24T09:00:00Z",
     "title_hash": "-1234567890123456789", "discussion_state": "none"},
    {"id": "00000000-0000-4000-8000-000000000072", "title": "Ferry capsizes off East Java",
     "category": 0, "lat": -7.25, "lon": 112.75, "place_name": "Surabaya, Indonesia",
     "place_conf": 60, "country_code": "ID", "heat": 20, "sentiment": -40, "source_count": 1,
     "published_at": "2026-09-24T07:30:00Z", "first_seen_at": "2026-09-24T09:00:00Z",
     "title_hash": "42", "discussion_state": "none"}
  ],
  "signals": [
    {"story_id": "00000000-0000-4000-8000-000000000071", "keys": ["p:t kelly", "o:cnn", "w:politico"],
     "state": {"v": 1}, "last_seen_at": "2026-09-24T09:00:00Z"},
    {"story_id": "00000000-0000-4000-8000-000000000072", "keys": ["l:-2703300", "w:capsized"],
     "state": {"v": 1}, "last_seen_at": "2026-09-24T09:00:00Z"}
  ],
  "articles": [
    {"story_id": "00000000-0000-4000-8000-000000000071", "url": "https://one.example/ban",
     "outlet": "one.example", "outlet_country": "US", "headline": "Judge blocks media ban",
     "image_url": null, "published_at": "2026-09-24T08:10:00Z", "lang": "en"},
    {"story_id": "00000000-0000-4000-8000-000000000071", "url": "https://two.example/ban",
     "outlet": "two.example", "outlet_country": "GB", "headline": "Judge lifts White House ban",
     "image_url": "https://two.example/i.jpg", "published_at": "2026-09-24T08:20:00Z", "lang": "en"},
    {"story_id": "00000000-0000-4000-8000-000000000072", "url": "https://three.example/ferry",
     "outlet": "three.example", "outlet_country": "SG", "headline": "Ferry capsizes off East Java",
     "image_url": null, "published_at": "2026-09-24T07:30:00Z", "lang": "en"}
  ]
}$json$::jsonb as b;

select is(public.ingest_apply((select b from batch)),
  '{"stories_new": 2, "stories_updated": 0, "articles_new": 3}'::jsonb,
  'a batch inserts its stories and articles');
select is((select title_hash from public.stories where id = '00000000-0000-4000-8000-000000000071'),
  -1234567890123456789::bigint, 'a 64-bit simhash survives the JSON round trip');
select is((select place_source from public.stories where id = '00000000-0000-4000-8000-000000000071'),
  'gdelt', 'ingested places are marked as GDELT''s');
select is((select keys from public.story_signals where story_id = '00000000-0000-4000-8000-000000000071'),
  array['p:t kelly', 'o:cnn', 'w:politico'], 'signals are stored beside the story');
select is((select status from public.ingest_runs where slot = '2026-09-24 09:00:00+00'), 'done',
  'the slot is marked done in the same transaction');
select ok(not public.ingest_claim('2026-09-24 09:00:00+00'), 'a done slot cannot be claimed');

select is(public.ingest_apply((select b from batch)),
  '{"stories_new": 0, "stories_updated": 2, "articles_new": 0}'::jsonb,
  'replaying a batch adds no stories or articles');
select is((select count(*) from public.articles
            where story_id in ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000072')),
  3::bigint, 'and leaves exactly one row per URL');

select is(
  array(select u from public.ingest_known_urls(array['https://one.example/ban', 'https://new.example/x']) as u),
  array['https://one.example/ban'], 'known URLs are reported, new ones are not');

-- Heat only rises; a queued story keeps its title and place; the state never
-- moves backwards.
update batch set b = jsonb_set(b, '{stories,0,heat}', '90');
select public.ingest_apply((select b from batch));
select is((select heat from public.stories where id = '00000000-0000-4000-8000-000000000071'),
  120::smallint, 'heat is the story''s peak: a lower score does not lower it');

update batch set b = jsonb_set(jsonb_set(b, '{stories,0,heat}', '230'), '{stories,0,discussion_state}', '"queued"');
select public.ingest_apply((select b from batch));
select is((select discussion_state from public.stories where id = '00000000-0000-4000-8000-000000000071'),
  'queued', 'crossing the threshold queues the story');

update batch set b = jsonb_set(jsonb_set(jsonb_set(b, '{stories,0,title}', '"A different title"'),
  '{stories,0,lat}', '10'), '{stories,0,discussion_state}', '"none"');
select public.ingest_apply((select b from batch));
select results_eq(
  $$select title, lat, discussion_state from public.stories where id = '00000000-0000-4000-8000-000000000071'$$,
  $$values ('Judge blocks media ban'::text, 38.8977::double precision, 'queued'::text)$$,
  'a queued story keeps its title and place, and is never un-queued');

-- One bad row fails the whole batch: nothing from it is written.
select throws_ok(
  $$select public.ingest_apply('{"slot": "2026-09-24T09:15:00Z",
     "stories": [{"id": "00000000-0000-4000-8000-000000000079", "title": "Half a batch", "category": 0,
       "lat": 0, "lon": 0, "place_name": null, "place_conf": 10, "country_code": null, "heat": 1,
       "sentiment": 0, "source_count": 1, "published_at": "2026-09-24T09:00:00Z",
       "first_seen_at": "2026-09-24T09:15:00Z", "title_hash": "1", "discussion_state": "none"}],
     "signals": [],
     "articles": [{"story_id": "00000000-0000-4000-8000-000000000079", "url": "javascript:alert(1)",
       "outlet": "x.example", "outlet_country": null, "headline": "x", "image_url": null,
       "published_at": null, "lang": "en"}]}'::jsonb)$$,
  '23514', null, 'a batch with an invalid article is refused');
select ok(not exists (select 1 from public.stories where id = '00000000-0000-4000-8000-000000000079'),
  'and none of that batch is written');
select ok(not exists (select 1 from public.ingest_runs where slot = '2026-09-24 09:15:00+00'),
  'nor is its slot marked done');

-- ---------------------------------------------------------------------------
-- Candidates: recent stories sharing at least p_min_overlap keys.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select cluster, story_id, overlap from public.ingest_candidates(
      '[{"i": 0, "keys": ["p:t kelly", "o:cnn", "w:judge"]}, {"i": 1, "keys": ["w:capsized", "w:ferry"]}]',
      '2026-09-24 00:00:00+00', 2)$$,
  $$values (0, '00000000-0000-4000-8000-000000000071'::uuid, 2)$$,
  'a cluster sharing two keys finds its story; one sharing a single key does not');
select is_empty(
  $$select * from public.ingest_candidates('[{"i": 0, "keys": ["p:t kelly", "o:cnn"]}]',
      '2026-09-25 00:00:00+00', 2)$$,
  'stories not seen since the cutoff are not candidates');

-- ---------------------------------------------------------------------------
-- Retention.
-- ---------------------------------------------------------------------------
insert into public.stories (id, title, category, lat, lon, published_at) values
  ('00000000-0000-4000-8000-000000000073', 'Old, with a debate', 0, 0, 0, now() - interval '49 hours'),
  ('00000000-0000-4000-8000-000000000074', 'Old, no debate',     0, 0, 0, now() - interval '49 hours'),
  ('00000000-0000-4000-8000-000000000075', 'Recent',             0, 0, 0, now() - interval '47 hours');
insert into public.articles (story_id, url, headline) values
  ('00000000-0000-4000-8000-000000000074', 'https://old.example/a', 'Old article');
insert into public.story_signals (story_id, keys, state, last_seen_at) values
  ('00000000-0000-4000-8000-000000000074', '{}', '{"v": 1}', now() - interval '49 hours');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label, closes_at) values
  ('00000000-0000-4000-8000-000000000073', 'Keep this?', 'Yes', 'No', now() + interval '1 hour');
insert into public.ingest_runs (slot, status) values (now() - interval '8 days', 'done');

insert into public.story_signals (story_id, keys, state, last_seen_at) values
  ('00000000-0000-4000-8000-000000000075', '{}', '{"v": 1}', now() - interval '30 hours');

select is(
  public.ingest_prune(now() - interval '48 hours', now() - interval '7 days', now() - interval '24 hours')
    - 'stories_deleted' - 'signals_deleted',
  '{"stories_kept_for_discussion": 1, "runs_deleted": 1}'::jsonb,
  'prune reports the story it kept for its discussion and the old run it removed');
select ok(exists (select 1 from public.stories where id = '00000000-0000-4000-8000-000000000075')
          and not exists (select 1 from public.story_signals
                           where story_id = '00000000-0000-4000-8000-000000000075'),
  'signals past the match window go, while their story stays');
select ok(not exists (select 1 from public.stories where id = '00000000-0000-4000-8000-000000000074'),
  'an old story without a discussion is deleted');
select ok(not exists (select 1 from public.articles where url = 'https://old.example/a')
          and not exists (select 1 from public.story_signals
                           where story_id = '00000000-0000-4000-8000-000000000074'),
  'its articles and signals go with it');
select ok(exists (select 1 from public.stories where id = '00000000-0000-4000-8000-000000000073'),
  'an old story with a discussion is kept');
select ok(exists (select 1 from public.stories where id = '00000000-0000-4000-8000-000000000075'),
  'a story inside the window is kept');

select * from finish();
rollback;
