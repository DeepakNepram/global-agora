-- The local badge (Prompt 4.4): a post's region label is written only with
-- the API Worker's secret, only in the shape "<city> area[, <country>]", and
-- it never reaches the rank or the moderation services. The Worker itself is
-- checked by its unit tests and db:smoke. Run with `npm run db:test`.
--
-- The Worker's headers are set here as PostgREST sets them for a request:
-- request.headers, names lower-cased, the label base64-encoded.
--
-- Fixture ids:
--   authors 7a1 and 7a2 (side a); voters 7b1..7b6 (side b)
--   the discussion on story 7f0; posts are told apart by their body
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- Fixtures write several posts per author at once; the posting limits have
-- their own test (15_posting_limits).
update private.posting_limits
   set posts_per_hour = 1000, seconds_between_posts = 0, new_account_posts_per_hour = 1000;

-- This test's own Vault entries, whatever the local seed holds. The
-- moderation URL is never reached: pg_net's queue rolls back with the test.
delete from vault.secrets
 where name in ('region_label_secret', 'moderation_function_url', 'moderation_hook_secret');
select vault.create_secret('test-region-secret', 'region_label_secret');
select vault.create_secret('http://moderation.test.invalid/moderate-post', 'moderation_function_url');
select vault.create_secret('test-hook-secret', 'moderation_hook_secret');

insert into auth.users (id, email)
  select format('00000000-0000-4000-8000-0000000007%s', n)::uuid, format('badge-%s@test.example', n)
    from unnest(array['a1', 'a2', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6']) n;
insert into public.profiles (id, handle, is_adult, rules_accepted_at)
  select format('00000000-0000-4000-8000-0000000007%s', n)::uuid, format('badge_%s', n), true, now()
    from unnest(array['a1', 'a2', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6']) n;
insert into public.stories (id, title, category, lat, lon, published_at, discussion_state) values
  ('00000000-0000-4000-8000-0000000007f0', 'Badged debate', 0, 12.97, 77.59, now(), 'open');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label) values
  ('00000000-0000-4000-8000-0000000007f0', 'Badged?', 'Yes', 'No');
insert into public.discussion_stances (story_id, user_id, stance)
  select '00000000-0000-4000-8000-0000000007f0',
         format('00000000-0000-4000-8000-0000000007%s', n)::uuid,
         case when n like 'a%' then 'a' else 'b' end
    from unnest(array['a1', 'a2', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6']) n;

-- What the Worker sends: the label, base64 (null for none), and the secret.
create function pg_temp.worker_headers(p_label text, p_secret text) returns text
language sql as $$
  select set_config('request.headers', jsonb_strip_nulls(jsonb_build_object(
    'x-region-label', encode(convert_to(p_label, 'UTF8'), 'base64'),
    'x-region-label-secret', p_secret))::text, true);
$$;
create function pg_temp.raw_headers(p_headers jsonb) returns text language sql as $$
  select set_config('request.headers', p_headers::text, true);
$$;
-- Clients cannot choose a post's id, so posts are told apart by their body.
create function pg_temp.post(p_body text) returns void language sql as $$
  insert into public.posts (story_id, body, kind)
  values ('00000000-0000-4000-8000-0000000007f0', p_body, 'argument');
$$;
create function pg_temp.label_of(p_body text) returns text language sql stable as $$
  select region_label from public.posts
   where story_id = '00000000-0000-4000-8000-0000000007f0' and body = p_body;
$$;
create function pg_temp.rank_of(p_body text) returns real language sql stable as $$
  select rank_score from public.posts
   where story_id = '00000000-0000-4000-8000-0000000007f0' and body = p_body;
$$;
grant execute on function pg_temp.worker_headers(text, text), pg_temp.raw_headers(jsonb),
  pg_temp.post(text), pg_temp.label_of(text) to authenticated;
grant execute on function pg_temp.label_of(text) to anon;

-- ---------------------------------------------------------------------------
-- The rank cannot see the label.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(column_name::text order by column_name)
     from information_schema.column_column_usage
    where table_schema = 'public' and table_name = 'posts' and dependent_column = 'rank_score'),
  array['changed_mind_count', 'cross_side_count', 'helpful_count'],
  'rank_score is generated from the three vote counts alone, never region_label');

-- ---------------------------------------------------------------------------
-- Author a1 posts through the Worker.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000007a1", "role": "authenticated"}', true);

select pg_temp.worker_headers('Bengaluru area, India', 'test-region-secret');
select lives_ok($$select pg_temp.post('labelled')$$,
  'a post sent with the Worker''s secret takes its label');
select is(pg_temp.label_of('labelled'),
  'Bengaluru area, India', 'and stores it as plain text');

select pg_temp.raw_headers('{}');
select lives_ok($$select pg_temp.post('unlabelled')$$,
  'a post without the label headers goes in');
select is(pg_temp.label_of('unlabelled'),
  null, 'with no label');

select pg_temp.raw_headers('{"x-region-label-secret": "test-region-secret"}');
select pg_temp.post('secret, no label');
select is(pg_temp.label_of('secret, no label'),
  null, 'the secret alone adds nothing');

select pg_temp.worker_headers('São Paulo area, Brazil', 'test-region-secret');
select pg_temp.post('accented');
select is(pg_temp.label_of('accented'),
  'São Paulo area, Brazil', 'a city name outside ASCII arrives intact');

select pg_temp.worker_headers('Bengaluru area', 'test-region-secret');
select pg_temp.post('no country');
select is(pg_temp.label_of('no country'),
  'Bengaluru area', 'a label without a country is fine');

-- ---------------------------------------------------------------------------
-- Nobody else writes one.
-- ---------------------------------------------------------------------------
select pg_temp.raw_headers('{}');
select throws_ok($$insert into public.posts (story_id, body, kind, region_label)
                   values ('00000000-0000-4000-8000-0000000007f0', 'own label', 'argument', 'Paris area, France')$$,
  '42501', null, 'a client cannot write the column itself');
select pg_temp.worker_headers('Paris area, France', 'guessed');
select throws_ok($$select pg_temp.post('wrong secret')$$,
  '42501', null, 'a label with the wrong secret is refused');
select pg_temp.worker_headers('Paris area, France', null);
select throws_ok($$select pg_temp.post('no secret')$$,
  '42501', null, 'and one with no secret');
select pg_temp.raw_headers('{"x-region-label": "not base64!", "x-region-label-secret": "test-region-secret"}');
select throws_ok($$select pg_temp.post('garbled')$$,
  '22023', null, 'a label that is not base64 is refused');
select pg_temp.raw_headers(jsonb_build_object('x-region-label', encode('\xff'::bytea, 'base64'),
                                              'x-region-label-secret', 'test-region-secret'));
select throws_ok($$select pg_temp.post('not utf-8')$$,
  '22023', null, 'and one that is not UTF-8');

-- ---------------------------------------------------------------------------
-- The shape: a coarse place name, never coordinates.
-- ---------------------------------------------------------------------------
select pg_temp.worker_headers('Bengaluru', 'test-region-secret');
select throws_ok($$select pg_temp.post('bare city')$$,
  '23514', null, 'a label must read "<city> area"');
select pg_temp.worker_headers('12.9716, 77.5946', 'test-region-secret');
select throws_ok($$select pg_temp.post('coordinates')$$,
  '23514', null, 'coordinates are refused');
select pg_temp.worker_headers('12.97 area, 77.59', 'test-region-secret');
select throws_ok($$select pg_temp.post('disguised coordinates')$$,
  '23514', null, 'even dressed as an area');
select pg_temp.worker_headers(E'Bengaluru area\nMG Road', 'test-region-secret');
select throws_ok($$select pg_temp.post('two lines')$$,
  '23514', null, 'a label is one line');
select pg_temp.worker_headers(repeat('x', 60) || ' area', 'test-region-secret');
select throws_ok($$select pg_temp.post('too long')$$,
  '23514', null, 'and at most 64 characters');
select pg_temp.raw_headers('{}');

-- ---------------------------------------------------------------------------
-- What the moderation services are sent: the id and the body, no label.
-- ---------------------------------------------------------------------------
reset role;
select is(
  (select array_agg(k order by k)
     from net.http_request_queue q,
          jsonb_object_keys(convert_from(q.body, 'utf8')::jsonb) k
    where convert_from(q.body, 'utf8')::jsonb ->> 'body' = 'labelled'),
  array['body', 'post_id'],
  'the labelled post goes to moderation as its id and body only');
select is(
  (select count(*)::integer from net.http_request_queue q
    where position('Bengaluru' in convert_from(q.body, 'utf8')) > 0),
  0, 'the label is in no moderation request');

-- ---------------------------------------------------------------------------
-- Same votes, same rank, label or not.
-- ---------------------------------------------------------------------------
create temporary table pair as
  select id, body, region_label from public.posts
   where story_id = '00000000-0000-4000-8000-0000000007f0' and body in ('labelled', 'unlabelled');
update public.posts set mod_state = 'ok' where id in (select id from pair);
insert into public.votes (post_id, voter_id, kind)
  select pair.id, format('00000000-0000-4000-8000-0000000007b%s', n)::uuid, kind
    from pair, generate_series(1, 6) n, (values ('helpful'), ('changed_mind')) k(kind)
   where kind = 'helpful' or n <= 2;
select ok(pg_temp.rank_of('labelled') > 0, 'the labelled post has a rank from its votes');
select is(pg_temp.rank_of('labelled'), pg_temp.rank_of('unlabelled'),
  'a labelled post ranks exactly level with an unlabelled one with the same votes');

create temporary table ranks_before as
  select id, rank_score from public.posts where id in (select id from pair);
update public.posts set region_label = null where id in (select id from pair where body = 'labelled');
update public.posts set region_label = 'Paris area, France'
 where id in (select id from pair where body = 'unlabelled');
select results_eq(
  $$select p.rank_score from public.posts p join ranks_before b using (id) order by id$$,
  $$select rank_score from ranks_before order by id$$,
  'adding or removing a label changes no rank');

-- ---------------------------------------------------------------------------
-- Everyone who sees the post sees its label, and without Vault, no labels.
-- ---------------------------------------------------------------------------
set local role anon;
select is(pg_temp.label_of('unlabelled'),
  'Paris area, France', 'a visitor sees an approved post''s label');
reset role;

delete from vault.secrets where name = 'region_label_secret';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000007a2", "role": "authenticated"}', true);
select pg_temp.worker_headers('Bengaluru area, India', 'test-region-secret');
select throws_ok($$select pg_temp.post('unconfigured')$$,
  '42501', null, 'with no secret in Vault every label is refused (fail closed)');
select pg_temp.raw_headers('{}');
select lives_ok($$select pg_temp.post('plain')$$,
  'while posts without one still go in');
reset role;

select * from finish();
rollback;
