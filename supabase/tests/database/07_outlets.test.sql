-- Outlet search (Prompt 3.4): api_window, api_outlets, api_outlet_stories.
-- Run with `npm run db:test`. The transaction rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Stories far in the future, so the window ends at them whatever the seed holds.
insert into public.stories
  (id, title, category, lat, lon, place_name, place_source, place_conf,
   heat, source_count, published_at, first_seen_at, discussion_state)
values
  ('00000000-0000-4000-8000-0000000000c1', 'Hottest', 1, 10, 10, 'A', 'gdelt', 30,
   250, 3, '2200-01-01 10:00:00+00', '2200-01-02 00:00:00+00', 'none'),
  ('00000000-0000-4000-8000-0000000000c2', 'Warm', 2, 20, 20, 'B', 'gdelt', 30,
   200, 2, '2200-01-01 20:00:00+00', '2200-01-01 20:05:00+00', 'none'),
  ('00000000-0000-4000-8000-0000000000c3', 'Cool', 3, 30, 30, 'C', 'gdelt', 30,
   100, 1, '2200-01-01 12:00:00+00', '2200-01-01 12:05:00+00', 'none'),
  -- Coldest: left out when the limit is 3.
  ('00000000-0000-4000-8000-0000000000c4', 'Coldest', 0, 40, 40, 'D', 'gdelt', 30,
   1, 1, '2200-01-01 13:00:00+00', '2200-01-01 13:05:00+00', 'none');

insert into public.articles (story_id, url, outlet, headline, published_at, lang)
values
  ('00000000-0000-4000-8000-0000000000c1', 'https://wire.example/1', 'wire.example', 'h', '2200-01-01 10:00:00+00', 'en'),
  ('00000000-0000-4000-8000-0000000000c1', 'https://wire.example/1b', 'wire.example', 'h', '2200-01-01 10:30:00+00', 'en'),
  ('00000000-0000-4000-8000-0000000000c1', 'https://daily.example/1', 'daily.example', 'h', '2200-01-01 11:00:00+00', 'en'),
  ('00000000-0000-4000-8000-0000000000c2', 'https://wire.example/2', 'wire.example', 'h', '2200-01-01 20:00:00+00', 'en'),
  ('00000000-0000-4000-8000-0000000000c3', 'https://zine.example/3', 'zine.example', 'h', '2200-01-01 12:00:00+00', 'en'),
  ('00000000-0000-4000-8000-0000000000c4', 'https://only.example/4', 'only.example', 'h', '2200-01-01 13:00:00+00', 'en');

create temp table seqs on commit drop as
  select id, seq from public.stories where id::text like '00000000-0000-4000-8000-0000000000c_';
grant select on seqs to anon;

set local role anon;
create temp table r on commit drop as
  select public.api_outlets(24, 3) as outlets,
         public.api_nodes(24, 3) as nodes,
         public.api_outlet_stories('wire.example', 24, 3) as wire,
         public.api_outlet_stories('only.example', 24, 3) as cold,
         public.api_outlet_stories('nobody.example', 24, 3) as nobody;
reset role;

-- One definition of the window: the payload and outlet search see the same stories.
select is(
  (select array_agg(seq order by seq) from public.api_window(24, 3)),
  (select array_agg(value::bigint order by value::bigint)
     from json_array_elements_text((select nodes->'payload'->'nodes'->'id' from r))),
  'api_window holds exactly the payload''s stories'
);
select is((select count(*) from public.api_window(24, 4)), 4::bigint, 'the limit decides how many');

select is((select outlets->'payload'->>'outlets' from r),
          '["wire.example","daily.example","zine.example"]',
          'outlets come most stories first, then by name');
select is((select outlets->'payload'->>'n' from r), '[2,1,1]',
          'each counts its stories once, however many articles');
select is((select (outlets->'payload'->>'window_hours')::int from r), 24, 'window_hours echoes the request');
select is((select (outlets->'payload'->>'generated_at')::bigint from r),
          extract(epoch from timestamptz '2200-01-02 00:00:00+00')::bigint,
          'the window ends at the newest story');
select ok((select outlets->'payload'->>'outlets' not like '%only.example%' from r),
          'an outlet whose only story is outside the window is not listed');

set local role anon;
select is(public.api_outlets(24, 3, (select outlets->>'hash' from r))::text,
          json_build_object('hash', (select outlets->>'hash' from r))::text,
          'a known hash returns the hash alone');
reset role;

select is((select wire->>'ids' from r),
          (select array_to_json(array[
             (select seq from seqs where id = '00000000-0000-4000-8000-0000000000c2'),
             (select seq from seqs where id = '00000000-0000-4000-8000-0000000000c1')])::text),
          'one outlet''s stories, newest first, as payload ids');
select is((select cold->>'ids' from r), '[]', 'a story outside the window is not among them');
select is((select nobody->>'ids' from r), '[]', 'an unknown outlet has none');

select throws_ok($$ select public.api_outlet_stories('', 24, 3) $$, '22023', null,
                 'an empty outlet name is refused');
select throws_ok($$ select public.api_window(0, 3) $$, '22023', null,
                 'the window has the same safety bounds');

select * from finish();
rollback;
