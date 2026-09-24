-- Constraints: the database refuses what the product rules forbid, whoever writes.
-- Runs as the table owner, which is how the service role's writes are checked too.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

-- Explains a query; used to prove the radius query takes the GIST index.
create function pg_temp.plan_of(query text) returns text
language plpgsql as $$
declare
  line text;
  result text := '';
begin
  for line in execute 'explain ' || query loop
    result := result || line || E'\n';
  end loop;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- stories and articles
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.stories (id, title, category, lat, lon, place_name, country_code, published_at)
    values ('00000000-0000-4000-8000-000000000051', 'Fixture story', 7, 41.01, 28.97,
            'Istanbul, Türkiye', 'TR', now())$$,
  'a valid story inserts (category 7 is the last of the 8)');

select throws_ok($$insert into public.stories (title, category, lat, lon, published_at) values ('x', 0, 91, 0, now())$$,
  '23514', null, 'latitude above 90 is refused');
select throws_ok($$insert into public.stories (title, category, lat, lon, published_at) values ('x', 0, 0, -181, now())$$,
  '23514', null, 'longitude below -180 is refused');
select throws_ok($$insert into public.stories (title, category, lat, lon, published_at) values ('x', 8, 0, 0, now())$$,
  '23514', null, 'a category past NEWS_CATEGORIES is refused');
select throws_ok($$insert into public.stories (title, category, lat, lon, published_at, heat) values ('x', 0, 0, 0, now(), 256)$$,
  '23514', null, 'heat above 255 is refused');
select throws_ok($$insert into public.stories (title, category, lat, lon, published_at, sentiment) values ('x', 0, 0, 0, now(), -101)$$,
  '23514', null, 'sentiment below -100 is refused');
select throws_ok($$insert into public.stories (title, category, lat, lon, published_at) values (repeat('x', 301), 0, 0, 0, now())$$,
  '23514', null, 'a title over 300 characters is refused');
select throws_ok($$insert into public.stories (title, summary, category, lat, lon, published_at) values ('x', repeat('x', 601), 0, 0, 0, now())$$,
  '23514', null, 'a summary over 600 characters is refused (no article bodies)');
select throws_ok($$insert into public.stories (title, category, lat, lon, published_at, discussion_state) values ('x', 0, 0, 0, now(), 'hot')$$,
  '23514', null, 'an unknown discussion_state is refused');
select throws_ok($$insert into public.stories (title, category, lat, lon, published_at, country_code) values ('x', 0, 0, 0, now(), 'tr')$$,
  '23514', null, 'a lower-case country code is refused');
select throws_ok($$insert into public.stories (title, category, lat, lon, published_at, geog)
                   values ('x', 0, 0, 0, now(), extensions.st_makepoint(1, 1)::extensions.geography)$$,
  '428C9', null, 'geog is derived from lat/lon and cannot be written');

select is(
  (select array[round(extensions.st_x(geog::extensions.geometry)::numeric, 6),
                round(extensions.st_y(geog::extensions.geometry)::numeric, 6)]
     from public.stories where id = '00000000-0000-4000-8000-000000000051'),
  array[28.97, 41.01]::numeric[],
  'geog is the point (lon, lat)');

set local enable_seqscan = off;
select matches(
  pg_temp.plan_of($$select id from public.stories
                     where extensions.st_dwithin(geog, extensions.st_makepoint(29.0, 41.0)::extensions.geography, 50000)$$),
  'stories_geog_gist',
  'a radius query uses the GIST index');
reset enable_seqscan;

select lives_ok(
  $$insert into public.articles (story_id, url, headline, snippet, lang, outlet_country)
    values ('00000000-0000-4000-8000-000000000051', 'https://fixture.example/a', 'Headline', repeat('x', 400), 'en', 'GB')$$,
  'a valid article inserts (snippet of exactly 400)');
select throws_ok($$insert into public.articles (story_id, url, headline, snippet)
                   values ('00000000-0000-4000-8000-000000000051', 'https://fixture.example/b', 'H', repeat('x', 401))$$,
  '23514', null, 'a snippet over 400 characters is refused (no article bodies)');
select throws_ok($$insert into public.articles (story_id, url, headline)
                   values ('00000000-0000-4000-8000-000000000051', 'javascript:alert(1)', 'H')$$,
  '23514', null, 'a non-http(s) article URL is refused');
select throws_ok($$insert into public.articles (story_id, url, headline)
                   values ('00000000-0000-4000-8000-000000000051', 'https://fixture.example/a', 'H')$$,
  '23505', null, 'an article URL can be stored only once');
select throws_ok($$insert into public.articles (url, headline) values ('https://fixture.example/c', 'H')$$,
  '23502', null, 'an article must belong to a story');

-- ---------------------------------------------------------------------------
-- discussions and posts
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'author@test.example'),
  ('00000000-0000-4000-8000-00000000000b', 'reporter@test.example');
insert into public.profiles (id, handle) values
  ('00000000-0000-4000-8000-00000000000a', 'author'),
  ('00000000-0000-4000-8000-00000000000b', 'reporter');

select throws_ok($$insert into public.discussions (story_id, prompt, side_a_label, side_b_label, opened_at, closes_at)
                   values ('00000000-0000-4000-8000-000000000051', 'P?', 'A', 'B', now(), now() - interval '1 hour')$$,
  '23514', null, 'a discussion cannot close before it opens');
select lives_ok($$insert into public.discussions (story_id, prompt, side_a_label, side_b_label, closes_at)
                  values ('00000000-0000-4000-8000-000000000051', 'P?', 'A', 'B', now() + interval '48 hours')$$,
  'a valid discussion inserts');

select lives_ok($$insert into public.posts (id, story_id, author_id, body, stance, kind)
                  values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000051',
                          '00000000-0000-4000-8000-00000000000a', repeat('x', 500), 'a', 'argument')$$,
  'a 500-character post is accepted');
select throws_ok($$insert into public.posts (story_id, author_id, body, stance, kind)
                   values ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-00000000000a', repeat('x', 501), 'a', 'argument')$$,
  '23514', null, 'a 501-character post is refused (CLAUDE.md #7)');
select lives_ok($$insert into public.posts (story_id, author_id, body, stance, kind)
                  values ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-00000000000a', repeat('😀', 500), 'b', 'argument')$$,
  '500 emoji count as 500 characters, not 1000 UTF-16 units');
select throws_ok($$insert into public.posts (story_id, author_id, body, stance, kind)
                   values ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-00000000000a', '', 'a', 'argument')$$,
  '23514', null, 'an empty post is refused');
select throws_ok($$insert into public.posts (story_id, author_id, body, stance, kind)
                   values ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-00000000000a', 'x', 'c', 'argument')$$,
  '23514', null, 'an unknown stance is refused');
select throws_ok($$insert into public.posts (story_id, author_id, body, stance, kind)
                   values ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-00000000000a', 'x', 'a', 'opinion')$$,
  '23514', null, 'an unknown kind is refused');
select throws_ok($$insert into public.posts (story_id, author_id, body, stance, kind)
                   values ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-00000000000a', 'x', 'a', 'evidence')$$,
  '23514', null, 'evidence without a URL is refused');
select lives_ok($$insert into public.posts (story_id, author_id, body, stance, kind, evidence_url)
                  values ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-00000000000a', 'x', 'a', 'evidence', 'https://fixture.example/proof')$$,
  'evidence with a URL is accepted');
select throws_ok($$insert into public.posts (story_id, author_id, body, stance, kind, region_label)
                   values ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-00000000000a', 'x', 'a', 'argument', repeat('x', 65))$$,
  '23514', null, 'a region label longer than a city name is refused (CLAUDE.md #5)');

-- ---------------------------------------------------------------------------
-- votes, blocks, reports, deletion
-- ---------------------------------------------------------------------------
select lives_ok($$insert into public.votes (post_id, voter_id, kind, voter_stance)
                  values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000b', 'helpful', 'b')$$,
  'a vote inserts');
select throws_ok($$insert into public.votes (post_id, voter_id, kind, voter_stance)
                   values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000b', 'helpful', 'b')$$,
  '23505', null, 'one vote per user per post per kind');
select throws_ok($$insert into public.blocks (blocker_id, blocked_id)
                   values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a')$$,
  '23514', null, 'a user cannot block themselves');

select throws_ok($$delete from public.stories where id = '00000000-0000-4000-8000-000000000051'$$,
  '23503', null, 'a story with a discussion cannot be deleted out from under it');

insert into public.reports (post_id, reporter_id, reason) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000b', 'spam');
select lives_ok($$delete from auth.users where id = '00000000-0000-4000-8000-00000000000b'$$,
  'a reporter can delete their account');
select is((select count(*) from public.reports where reporter_id is null), 1::bigint,
  'their report survives, detached from them, for the moderation record');
select is((select count(*) from public.votes), 0::bigint,
  'their votes are deleted with them');

select lives_ok($$delete from auth.users where id = '00000000-0000-4000-8000-00000000000a'$$,
  'an author can delete their account (Prompt 4.1: deletion that actually deletes)');
select is((select count(*) from public.posts), 0::bigint, 'their posts are deleted with them');
select is((select count(*) from public.profiles), 0::bigint, 'and so is their profile');

select * from finish();
rollback;
