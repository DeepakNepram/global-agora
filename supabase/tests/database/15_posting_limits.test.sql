-- Posting limits (Prompt 4.3): 1 post per 30 seconds, 5 an hour, 2 an hour
-- for accounts under 24 hours old; config values per tier. Run with
-- `npm run db:test`. Rolls back.
--
-- now() is fixed inside a transaction, so earlier posts are written by the
-- owner with past created_at values, and each check is a client insert now.
--
-- Fixture ids:
--   readers 6a1 (E, a 3-day-old account), 6a2 (N, new), 6a3 (T, tier pro)
--   discussions on stories 6b1 (open) and 6b2 (closed)
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-0000000006a1', 'limits-e@test.example', now() - interval '3 days'),
  ('00000000-0000-4000-8000-0000000006a2', 'limits-n@test.example', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-0000000006a3', 'limits-t@test.example', now() - interval '3 days');
insert into public.profiles (id, handle, is_adult, rules_accepted_at, tier) values
  ('00000000-0000-4000-8000-0000000006a1', 'limits_e', true, now(), 'free'),
  ('00000000-0000-4000-8000-0000000006a2', 'limits_n', true, now(), 'free'),
  ('00000000-0000-4000-8000-0000000006a3', 'limits_t', true, now(), 'pro');
insert into public.stories (id, title, category, lat, lon, published_at, discussion_state) values
  ('00000000-0000-4000-8000-0000000006b1', 'Busy debate', 0, 41.01, 28.97, now(), 'open'),
  ('00000000-0000-4000-8000-0000000006b2', 'Closed debate', 0, 48.85, 2.35, now(), 'closed');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label, opened_at, closes_at, state)
values
  ('00000000-0000-4000-8000-0000000006b1', 'Busy?', 'Yes', 'No', now() - interval '3 hours',
   now() + interval '1 day', 'open'),
  ('00000000-0000-4000-8000-0000000006b2', 'Closed?', 'Yes', 'No', now() - interval '3 days',
   now() - interval '1 day', 'closed');
insert into public.discussion_stances (story_id, user_id, stance)
select '00000000-0000-4000-8000-0000000006b1', id, 'a' from public.profiles
 where id::text like '00000000-0000-4000-8000-0000000006a_';
insert into public.discussion_stances (story_id, user_id, stance) values
  ('00000000-0000-4000-8000-0000000006b2', '00000000-0000-4000-8000-0000000006a1', 'a');

-- The owner writes an author's earlier posts, minutes ago.
create function pg_temp.posted(p_author text, p_minutes_ago integer[]) returns void
language sql as $$
  insert into public.posts (story_id, author_id, body, stance, kind, mod_state, created_at)
  select '00000000-0000-4000-8000-0000000006b1', ('00000000-0000-4000-8000-0000000006' || p_author)::uuid,
         'earlier post', 'a', 'argument', 'ok', now() - make_interval(mins => m)
    from unnest(p_minutes_ago) m;
$$;

-- A client post now, as whoever the claims say; the refusal's detail, or 'posted'.
create function pg_temp.post_now(p_story text default '6b1') returns text
language plpgsql as $$
declare
  v_detail text;
begin
  insert into public.posts (story_id, body, kind)
  values (('00000000-0000-4000-8000-000000000' || p_story)::uuid, 'a post now', 'argument');
  return 'posted';
exception when sqlstate 'PT429' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;
grant execute on function pg_temp.post_now(text) to authenticated;

create function pg_temp.as_reader(p_reader text) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000006' || p_reader,
                      'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_reader(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The settings.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select posts_per_hour, seconds_between_posts, new_account_hours, new_account_posts_per_hour
      from private.posting_limits where tier = 'free'$$,
  $$values (5::smallint, 30, 24, 2::smallint)$$,
  'the free tier: 5 an hour, 30 seconds apart, 2 an hour for the first 24 hours');
select throws_ok($$update private.posting_limits set posts_per_hour = 0$$, '23514', null,
  'a limit cannot be zero');

-- ---------------------------------------------------------------------------
-- 30 seconds apart.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_reader('a1');
select is(pg_temp.post_now(), 'posted', 'E posts');
select throws_ok($$insert into public.posts (story_id, body, kind)
                   values ('00000000-0000-4000-8000-0000000006b1', 'again', 'argument')$$,
  'PT429', 'Posting too fast: you can post again in 30 seconds.',
  'a second post straight after is refused (PT429: HTTP 429)');
select is(pg_temp.post_now()::jsonb,
  '{"retry_after_seconds": 30, "limit": "spacing", "posts_per_hour": 5}'::jsonb,
  'the detail says how long, and which limit');
select is((select count(*) from public.posts where author_id = auth.uid()), 1::bigint,
  'a refused post leaves nothing behind');
reset role;

update public.posts set created_at = now() - interval '29 seconds'
 where author_id = '00000000-0000-4000-8000-0000000006a1';
set local role authenticated;
select is(pg_temp.post_now()::jsonb ->> 'retry_after_seconds', '1', '29 seconds on: 1 to go');
reset role;
update public.posts set created_at = now() - interval '31 seconds'
 where author_id = '00000000-0000-4000-8000-0000000006a1';
set local role authenticated;
select is(pg_temp.post_now(), 'posted', '31 seconds on: E posts again');
reset role;

-- ---------------------------------------------------------------------------
-- 5 an hour, whatever moderation made of them.
-- ---------------------------------------------------------------------------
delete from public.posts where author_id = '00000000-0000-4000-8000-0000000006a1';
select pg_temp.posted('a1', array[50, 40, 30, 20]);
set local role authenticated;
select is(pg_temp.post_now(), 'posted', 'the fifth post in an hour is allowed');
reset role;
update public.posts set created_at = now() - interval '1 minute'
 where author_id = '00000000-0000-4000-8000-0000000006a1' and body = 'a post now';
set local role authenticated;
select is(pg_temp.post_now()::jsonb,
  '{"retry_after_seconds": 600, "limit": "hourly", "posts_per_hour": 5}'::jsonb,
  'the sixth is refused until the oldest of the five is an hour old (10 minutes)');
reset role;
update public.posts set mod_state = 'removed'
 where author_id = '00000000-0000-4000-8000-0000000006a1' and created_at < now() - interval '30 minutes';
set local role authenticated;
select is(pg_temp.post_now()::jsonb ->> 'limit', 'hourly', 'removed posts still count');
reset role;
update public.posts set created_at = created_at - interval '11 minutes'
 where author_id = '00000000-0000-4000-8000-0000000006a1' and created_at < now() - interval '45 minutes';
set local role authenticated;
select is(pg_temp.post_now(), 'posted', 'once the oldest is over an hour old, there is room');
reset role;

-- ---------------------------------------------------------------------------
-- New accounts: 2 an hour for the first 24 hours.
-- ---------------------------------------------------------------------------
select pg_temp.posted('a2', array[40, 20]);
set local role authenticated;
select pg_temp.as_reader('a2');
select is(pg_temp.post_now()::jsonb,
  '{"retry_after_seconds": 1200, "limit": "hourly", "posts_per_hour": 2}'::jsonb,
  'a 2-hour-old account''s third post in an hour is refused');
reset role;
update auth.users set created_at = now() - interval '25 hours'
 where id = '00000000-0000-4000-8000-0000000006a2';
set local role authenticated;
select is(pg_temp.post_now(), 'posted', 'at 25 hours old, the ordinary limit applies');
reset role;

-- ---------------------------------------------------------------------------
-- Per tier, and tunable.
-- ---------------------------------------------------------------------------
select pg_temp.posted('a3', array[50, 40, 30, 20, 10]);
set local role authenticated;
select pg_temp.as_reader('a3');
select is(pg_temp.post_now()::jsonb ->> 'posts_per_hour', '5',
  'a tier with no row of its own gets the free limits');
reset role;
insert into private.posting_limits
  (tier, posts_per_hour, seconds_between_posts, new_account_hours, new_account_posts_per_hour)
values ('pro', 10, 10, 24, 2);
set local role authenticated;
select is(pg_temp.post_now(), 'posted', 'a tier with its own row gets its own limits');
select is(pg_temp.post_now()::jsonb,
  '{"retry_after_seconds": 10, "limit": "spacing", "posts_per_hour": 10}'::jsonb,
  'including its own spacing');
reset role;

update private.posting_limits set seconds_between_posts = 0, posts_per_hour = 100 where tier = 'free';
set local role authenticated;
select pg_temp.as_reader('a1');
select is(pg_temp.post_now(), 'posted', 'tuning the free row changes the outcome');
select is(pg_temp.post_now(), 'posted', 'with no spacing, posts can follow straight on');
reset role;
update private.posting_limits set seconds_between_posts = 30, posts_per_hour = 5 where tier = 'free';

-- ---------------------------------------------------------------------------
-- What the reader is told first, and what clients may see.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_reader('a1');
select throws_ok($$insert into public.posts (story_id, body, kind)
                   values ('00000000-0000-4000-8000-0000000006b2', 'too late', 'argument')$$,
  '42501', null, 'a closed debate is refused as closed, not as too fast');
select throws_ok($$insert into public.posts (story_id, body, kind)
                   values ('00000000-0000-4000-8000-0000000006b1', repeat('x', 501), 'argument')$$,
  '23514', null, 'a post over 500 characters is refused as too long');
select throws_ok($$insert into public.posts (story_id, body, kind)
                   values ('00000000-0000-4000-8000-0000000006b1', 'busy', 'argument')$$,
  'PT429', null, 'a valid post is refused as too fast');
select throws_ok('select * from private.posting_limits', '42501', null,
  'clients cannot read the limits table');
reset role;

select is(has_function_privilege('authenticated', 'private.posts_rate_limit()', 'execute'), false,
  'nor run the trigger');
select is(
  (select tgname::text from pg_trigger
    where tgrelid = 'public.posts'::regclass and tgfoid = 'private.posts_rate_limit'::regproc),
  'posts_rate_limit', 'every insert into posts goes through it');
select ok(
  (select tgtype & 2 = 0 from pg_trigger where tgname = 'posts_rate_limit'),
  'after the insert: RLS and CHECKs speak first');

select * from finish();
rollback;
