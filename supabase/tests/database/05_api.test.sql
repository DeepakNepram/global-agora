-- API read functions: the payload's window, selection, order, quantization and
-- unchanged check; one story in full; and client access to exactly these two.
--
-- The fixtures are dated in 2100 so they alone define the payload's window,
-- whatever the seed or a local ingest left in the table.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into public.stories
  (id, title, category, lat, lon, place_name, place_source, place_conf, country_code,
   heat, source_count, published_at, first_seen_at, discussion_state)
values
  -- Newest first-seen time: the window ends here, 2100-01-02 00:00 UTC.
  ('00000000-0000-4000-8000-0000000000b1', 'Oldest in the window', 1, 90, 180,
   'North Pole', 'gdelt', 30, null, 200, 12, '2100-01-01 00:00:10+00', '2100-01-02 00:00:00+00', 'open'),
  ('00000000-0000-4000-8000-0000000000b2', 'Middle story', 2, -90, -180,
   null, 'gdelt', 55, null, 150, 3, '2100-01-01 12:00:00+00', '2100-01-01 12:15:00+00', 'none'),
  ('00000000-0000-4000-8000-0000000000b3', 'Newest story', 3, 0, 0,
   'Null Island', 'manual', 80, null, 100, 2, '2100-01-01 23:59:59+00', '2100-01-02 00:00:00+00', 'queued'),
  -- Coolest in the window: dropped when the limit is 3.
  ('00000000-0000-4000-8000-0000000000b4', 'Coolest story', 0, 51.5, -0.1,
   'London, United Kingdom', 'gdelt', 80, 'GB', 10, 1, '2100-01-01 06:00:00+00', '2100-01-01 06:15:00+00', 'none'),
  -- Hot, but published before the 24 h window opens.
  ('00000000-0000-4000-8000-0000000000b5', 'Too old for the window', 4, 10, 10,
   'Somewhere', 'gdelt', 80, null, 255, 40, '2099-12-31 23:00:00+00', '2100-01-01 00:00:00+00', 'none');

insert into public.articles (story_id, url, outlet, outlet_country, headline, published_at, lang)
values
  ('00000000-0000-4000-8000-0000000000b1', 'https://a.example/1', 'a.example', 'US', 'First write-up', '2100-01-01 00:00:10+00', 'en'),
  ('00000000-0000-4000-8000-0000000000b1', 'https://b.example/2', 'b.example', 'GB', 'Second write-up', '2100-01-01 03:00:00+00', 'en'),
  ('00000000-0000-4000-8000-0000000000b1', 'https://c.example/3', 'c.example', null, 'No publish time', null, 'en');

create temp table seqs on commit drop as
  select id, seq from public.stories where id::text like '00000000-0000-4000-8000-0000000000b_';
grant select on seqs to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Short ids.
-- ---------------------------------------------------------------------------
select has_column('public', 'stories', 'seq', 'stories has a short id');
select col_is_unique('public', 'stories', 'seq', 'seq is unique');
select is((select count(distinct seq) from seqs), 5::bigint, 'every inserted story got a seq');

-- ---------------------------------------------------------------------------
-- api_nodes, called as a signed-out client.
-- ---------------------------------------------------------------------------
set local role anon;
create temp table n on commit drop as
  select public.api_nodes(24, 3) as r, public.api_nodes(24, 10) as all_rows;
reset role;

select is((select (r->'payload'->>'generated_at')::bigint from n),
          extract(epoch from timestamptz '2100-01-02 00:00:00+00')::bigint,
          'the window ends at the newest story');
select is((select (r->'payload'->>'window_hours')::int from n), 24, 'window_hours echoes the request');
select is((select json_array_length(r->'payload'->'nodes'->'id') from n), 3, 'the limit keeps the hottest 3');
select is((select json_array_length(all_rows->'payload'->'nodes'->'id') from n), 4,
          'a story published before the window is left out');
select is((select (r->'payload'->'nodes'->>'hl') from n),
          '["Oldest in the window","Middle story","Newest story"]',
          'nodes come in time order, coolest dropped');
select is((select (r->'payload'->'nodes'->>'id') from n),
          (select array_to_json(array[
             (select seq from seqs where id = '00000000-0000-4000-8000-0000000000b1'),
             (select seq from seqs where id = '00000000-0000-4000-8000-0000000000b2'),
             (select seq from seqs where id = '00000000-0000-4000-8000-0000000000b3')])::text),
          'id is the seq, in the same order');
select is((select (r->'payload'->'nodes'->>'lonQ') from n), '[32767,-32767,0]',
          'lonQ = round(lon / 180 * 32767)');
select is((select (r->'payload'->'nodes'->>'latQ') from n), '[32767,-32767,0]',
          'latQ = round(lat / 90 * 32767)');
select is((select (r->'payload'->'nodes'->>'t') from n), '[10,43200,86399]',
          't counts whole seconds from the window start');
select is((select (r->'payload'->'nodes'->>'cat') from n), '[1,2,3]', 'category indexes');
select is((select (r->'payload'->'nodes'->>'heat') from n), '[200,150,100]', 'heat');
select is((select (r->'payload'->'nodes'->>'srcN') from n), '[12,3,2]', 'source counts');
select is((select (r->'payload'->'nodes'->>'disc') from n), '[1,0,0]',
          'disc is 1 only for an open discussion');
select is((select (r->'payload'->'nodes'->>'pl') from n), '["North Pole","","Null Island"]',
          'place names, empty when unknown');
select ok((select (r->'payload'->'nodes'->>'id') !~ ' ' from n), 'columns are written without spaces');

-- The unchanged check: the same data gives the same hash, and a caller that
-- already has it gets the hash alone.
set local role anon;
select is((select public.api_nodes(24, 3)->>'hash'), (select r->>'hash' from n), 'the hash is stable');
select is(public.api_nodes(24, 3, (select r->>'hash' from n))::text,
          json_build_object('hash', (select r->>'hash' from n))::text,
          'a known hash returns the hash alone');
select isnt((select public.api_nodes(24, 3, 'stale')->'payload') is null, true,
            'a different hash returns the payload');
select throws_ok('select public.api_nodes(0, 3)', '22023', null, 'hours below 1 are refused');
select throws_ok('select public.api_nodes(24, 0)', '22023', null, 'a limit below 1 is refused');
reset role;

update public.stories set heat = 201 where id = '00000000-0000-4000-8000-0000000000b2';
select isnt((select public.api_nodes(24, 3)->>'hash'), (select r->>'hash' from n),
            'a change to a story changes the hash');

-- ---------------------------------------------------------------------------
-- api_story, called as a signed-out client.
-- ---------------------------------------------------------------------------
set local role anon;
create temp table st on commit drop as
  select public.api_story(p_seq => (select seq from seqs where id = '00000000-0000-4000-8000-0000000000b1')) as by_seq,
         public.api_story(p_id => '00000000-0000-4000-8000-0000000000b1') as by_id,
         public.api_story(p_id => '00000000-0000-4000-8000-0000000000b1', p_article_limit => 1) as capped;
reset role;

select is((select by_seq::text from st), (select by_id::text from st), 'seq and UUID find the same story');
select is((select by_seq->>'id' from st), '00000000-0000-4000-8000-0000000000b1',
          'the story carries its UUID');
select is((select by_seq->'place'->>'source' from st), 'gdelt', 'place provenance: source');
select is((select (by_seq->'place'->>'confidence')::int from st), 30, 'place provenance: confidence');
select is((select by_seq->'discussion'->>'state' from st), 'open', 'discussion state');
select is((select json_agg(a->>'headline')::text from st, json_array_elements(by_seq->'articles') a),
          '["Second write-up", "First write-up", "No publish time"]',
          'articles newest first, undated last');
select is((select (capped->>'article_count')::int || '/' || json_array_length(capped->'articles') from st),
          '3/1', 'the article cap shortens the list, not the count');
select ok(public.api_story(p_seq => -1) is null, 'an unknown story is null');

select * from finish();
rollback;
