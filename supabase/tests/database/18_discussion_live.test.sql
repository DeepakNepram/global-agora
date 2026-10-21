-- The live discussion feed (Prompt 4.5): a post's id is broadcast when it
-- becomes visible and when it stops, and the room's balance counts what the
-- reader can see. The round trip over the real Realtime service is checked
-- by db:smoke. Run with `npm run db:test`.
--
-- private.realtime_send, the one caller of realtime.send, is replaced inside
-- this transaction by a recorder, so the checks are exact and need no
-- Realtime service. realtime.send itself cannot be replaced: its schema
-- belongs to supabase_admin, and tests run as postgres. The real
-- private.realtime_send comes back for the last check: posting works with
-- realtime.send installed or not (Realtime turned off in config.toml).
--
-- Fixture ids:
--   authors 8a1 (side a), 8a2 and 8a3 (side b), 8a4 (neutral)
--   readers 8b1 (blocks 8a2) and 8b2 (blocked by 8a1)
--   story 8f0: the broadcasts; story 8f1: the balance (posts 8d1..8d8)
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- Fixtures write several posts per author at once; the posting limits have
-- their own test (15_posting_limits).
update private.posting_limits
   set posts_per_hour = 1000, seconds_between_posts = 0, new_account_posts_per_hour = 1000;

-- The recorder writes into this table, so the table comes first: a SQL
-- function's body is checked when it is created. The real function's
-- definition is kept to put it back later.
create temporary table sent (
  n       serial primary key,
  payload jsonb,
  event   text,
  topic   text,
  private boolean
);
create temporary table real_send as
  select pg_get_functiondef('private.realtime_send(jsonb, text, text, boolean)'::regprocedure) as def;
create or replace function private.realtime_send(payload jsonb, event text, topic text, private boolean)
returns void
language sql as $$
  insert into pg_temp.sent (payload, event, topic, private) values ($1, $2, $3, $4);
$$;

insert into auth.users (id, email)
  select format('00000000-0000-4000-8000-0000000008%s', n)::uuid, format('live-%s@test.example', n)
    from unnest(array['a1', 'a2', 'a3', 'a4', 'b1', 'b2']) n;
insert into public.profiles (id, handle, is_adult, rules_accepted_at)
  select format('00000000-0000-4000-8000-0000000008%s', n)::uuid, format('live_%s', n), true, now()
    from unnest(array['a1', 'a2', 'a3', 'a4', 'b1', 'b2']) n;
insert into public.stories (id, title, category, lat, lon, published_at, discussion_state) values
  ('00000000-0000-4000-8000-0000000008f0', 'Live debate', 0, 52.52, 13.40, now(), 'open'),
  ('00000000-0000-4000-8000-0000000008f1', 'Balanced debate', 0, 59.33, 18.07, now(), 'open');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label) values
  ('00000000-0000-4000-8000-0000000008f0', 'Live?', 'Yes', 'No'),
  ('00000000-0000-4000-8000-0000000008f1', 'Balanced?', 'Yes', 'No');
insert into public.discussion_stances (story_id, user_id, stance)
  select s.id::uuid, format('00000000-0000-4000-8000-0000000008%s', n)::uuid,
         case n when 'a1' then 'a' when 'a4' then 'neutral' else 'b' end
    from unnest(array['a1', 'a2', 'a3', 'a4']) n,
         unnest(array['00000000-0000-4000-8000-0000000008f0',
                       '00000000-0000-4000-8000-0000000008f1']) s(id);

-- Clients cannot choose a post's id, so posts they send are told apart by
-- their body. Fixtures written here as postgres carry their own ids.
create function pg_temp.post(p_body text) returns void language sql as $$
  insert into public.posts (story_id, body, kind)
  values ('00000000-0000-4000-8000-0000000008f0', p_body, 'argument');
$$;
create function pg_temp.id_of(p_body text) returns uuid language sql stable as $$
  select id from public.posts
   where story_id = '00000000-0000-4000-8000-0000000008f0' and body = p_body;
$$;
-- The broadcasts since the last call, oldest first.
create function pg_temp.drain() returns table (event text, topic text, payload jsonb, private boolean)
language sql as $$
  with d as (delete from pg_temp.sent returning *)
  select d.event, d.topic, d.payload, d.private from d order by d.n;
$$;
-- Default privileges leave pg_temp functions closed to client roles.
grant execute on function pg_temp.post(text) to authenticated;

-- ---------------------------------------------------------------------------
-- What clients may call.
-- ---------------------------------------------------------------------------
select has_function('public', 'discussion_balance', array['uuid'], 'discussion_balance exists');
select is((select prosecdef from pg_proc where oid = 'public.discussion_balance(uuid)'::regprocedure),
  false, 'and runs as the caller, so the posts RLS applies to it');
select is(has_function_privilege('anon', 'public.discussion_balance(uuid)', 'execute'), true,
  'visitors may ask for the balance');
select is(has_function_privilege('authenticated', 'public.discussion_balance(uuid)', 'execute'), true,
  'and signed-in readers');
select is(
  array[has_function_privilege('anon', 'private.posts_broadcast()', 'execute'),
        has_function_privilege('anon', 'private.realtime_send(jsonb, text, text, boolean)', 'execute')],
  array[false, false], 'visitors cannot run the broadcast trigger or send to Realtime');
select is(
  array[has_function_privilege('authenticated', 'private.posts_broadcast()', 'execute'),
        has_function_privilege('authenticated', 'private.realtime_send(jsonb, text, text, boolean)',
                               'execute')],
  array[false, false], 'nor can signed-in readers');
select is(
  (select array_agg(tgname::text order by tgname) from pg_trigger
    where tgrelid = 'public.posts'::regclass and tgfoid = 'private.posts_broadcast'::regproc),
  array['posts_broadcast_delete', 'posts_broadcast_insert', 'posts_broadcast_update'],
  'posts broadcast on insert, on a change of mod_state, and on delete');

-- ---------------------------------------------------------------------------
-- 'post' when a post becomes visible.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000008a1", "role": "authenticated"}', true);
select pg_temp.post('approved later');
reset role;
select is_empty('select * from pg_temp.drain()', 'an author''s post, pending, sends nothing');

update public.posts set mod_state = 'ok' where id = pg_temp.id_of('approved later');
select results_eq('select * from pg_temp.drain()',
  $$values ('post'::text, 'discussion:00000000-0000-4000-8000-0000000008f0'::text,
            jsonb_build_object('id', pg_temp.id_of('approved later')), false)$$,
  'approving it sends one public ''post'' on the discussion''s topic, carrying the id alone');

insert into public.votes (post_id, voter_id, kind, voter_stance)
  values (pg_temp.id_of('approved later'), '00000000-0000-4000-8000-0000000008a2', 'helpful', 'b');
select is((select helpful_count from public.posts where id = pg_temp.id_of('approved later')), 1,
  'a vote updates the post''s counts');
select is_empty('select * from pg_temp.drain()', 'and sends nothing');
update public.posts set mod_state = 'ok' where id = pg_temp.id_of('approved later');
select is_empty('select * from pg_temp.drain()', 'nor does writing ''ok'' over ''ok''');

insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state) values
  ('00000000-0000-4000-8000-0000000008c1', '00000000-0000-4000-8000-0000000008f0',
   '00000000-0000-4000-8000-0000000008a2', 'held', 'b', 'argument', 'hidden');
select is_empty('select * from pg_temp.drain()', 'a post held as hidden sends nothing');
update public.posts set mod_state = 'ok' where id = '00000000-0000-4000-8000-0000000008c1';
select results_eq('select * from pg_temp.drain()',
  $$values ('post'::text, 'discussion:00000000-0000-4000-8000-0000000008f0'::text,
            '{"id": "00000000-0000-4000-8000-0000000008c1"}'::jsonb, false)$$,
  'and ''post'' when a moderator approves it');

insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state) values
  ('00000000-0000-4000-8000-0000000008c2', '00000000-0000-4000-8000-0000000008f0',
   '00000000-0000-4000-8000-0000000008a3', 'approved at once', 'b', 'argument', 'ok');
select results_eq('select * from pg_temp.drain()',
  $$values ('post'::text, 'discussion:00000000-0000-4000-8000-0000000008f0'::text,
            '{"id": "00000000-0000-4000-8000-0000000008c2"}'::jsonb, false)$$,
  'a post inserted as approved sends ''post''');

-- ---------------------------------------------------------------------------
-- 'gone' when a visible post stops being visible, and only then.
-- ---------------------------------------------------------------------------
update public.posts set mod_state = 'removed' where id = pg_temp.id_of('approved later');
select results_eq('select * from pg_temp.drain()',
  $$values ('gone'::text, 'discussion:00000000-0000-4000-8000-0000000008f0'::text,
            jsonb_build_object('id', pg_temp.id_of('approved later')), false)$$,
  'removing an approved post sends ''gone''');

delete from public.posts where id = '00000000-0000-4000-8000-0000000008c2';
select results_eq('select * from pg_temp.drain()',
  $$values ('gone'::text, 'discussion:00000000-0000-4000-8000-0000000008f0'::text,
            '{"id": "00000000-0000-4000-8000-0000000008c2"}'::jsonb, false)$$,
  'deleting an approved post sends ''gone''');

insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state) values
  ('00000000-0000-4000-8000-0000000008c3', '00000000-0000-4000-8000-0000000008f0',
   '00000000-0000-4000-8000-0000000008a3', 'never seen', 'b', 'argument', 'hidden');
update public.posts set mod_state = 'removed' where id = '00000000-0000-4000-8000-0000000008c3';
delete from public.posts where id = '00000000-0000-4000-8000-0000000008c3';
select is_empty('select * from pg_temp.drain()',
  'a post nobody could see sends nothing, removed or deleted');

-- ---------------------------------------------------------------------------
-- The real sender again. Without realtime.send (Realtime turned off) it
-- skips the call; with it, the message goes to realtime.messages and rolls
-- back with the test. Posting works either way.
-- ---------------------------------------------------------------------------
do $$ begin execute (select def from pg_temp.real_send); end $$;
select diag(case when to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null
                 then 'realtime.send is not installed: the sender skips it'
                 else 'realtime.send is installed: the sender calls it' end);
select is((select prolang from pg_proc
            where oid = 'private.realtime_send(jsonb, text, text, boolean)'::regprocedure),
  (select oid from pg_language where lanname = 'plpgsql'), 'the real sender is back');
insert into public.posts (id, story_id, author_id, body, stance, kind) values
  ('00000000-0000-4000-8000-0000000008c4', '00000000-0000-4000-8000-0000000008f0',
   '00000000-0000-4000-8000-0000000008a1', 'approved for real', 'a', 'argument');
select lives_ok(
  $$update public.posts set mod_state = 'ok' where id = '00000000-0000-4000-8000-0000000008c4'$$,
  'approving a post works through the real sender');
select is((select mod_state from public.posts where id = '00000000-0000-4000-8000-0000000008c4'),
  'ok', 'and the post is approved');

-- ---------------------------------------------------------------------------
-- The balance: approved posts per side, as the reader sees them.
-- ---------------------------------------------------------------------------
insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state)
  select format('00000000-0000-4000-8000-0000000008%s', p.id)::uuid,
         '00000000-0000-4000-8000-0000000008f1',
         format('00000000-0000-4000-8000-0000000008%s', p.author)::uuid,
         p.body, p.stance, 'argument', p.state
    from (values ('d1', 'a1', 'a one', 'a', 'ok'),
                 ('d2', 'a1', 'a two', 'a', 'ok'),
                 ('d3', 'a2', 'b one', 'b', 'ok'),
                 ('d4', 'a3', 'b two', 'b', 'ok'),
                 ('d5', 'a4', 'neutral one', 'neutral', 'ok'),
                 ('d6', 'a2', 'b pending', 'b', 'pending'),
                 ('d7', 'a1', 'a hidden', 'a', 'hidden'),
                 ('d8', 'a2', 'b removed', 'b', 'removed')) p(id, author, body, stance, state);
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-0000000008a2'),
  ('00000000-0000-4000-8000-0000000008a1', '00000000-0000-4000-8000-0000000008b2');

set local role anon;
select results_eq(
  $$select * from public.discussion_balance('00000000-0000-4000-8000-0000000008f1')$$,
  $$values ('a'::text, 2::bigint), ('b', 2), ('neutral', 1)$$,
  'a visitor sees the approved posts per side, nothing pending, hidden or removed');
select is_empty(
  $$select * from public.discussion_balance('00000000-0000-4000-8000-000000000fff')$$,
  'a story without a discussion has no balance');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000008a2", "role": "authenticated"}', true);
select is(
  (select count(*) from public.posts
    where story_id = '00000000-0000-4000-8000-0000000008f1'
      and author_id = '00000000-0000-4000-8000-0000000008a2'),
  3::bigint, 'an author sees their own pending and removed posts');
select results_eq(
  $$select * from public.discussion_balance('00000000-0000-4000-8000-0000000008f1')$$,
  $$values ('a'::text, 2::bigint), ('b', 2), ('neutral', 1)$$,
  'but the balance counts only the approved one');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000008b1", "role": "authenticated"}', true);
select results_eq(
  $$select * from public.discussion_balance('00000000-0000-4000-8000-0000000008f1')$$,
  $$values ('a'::text, 2::bigint), ('b', 1), ('neutral', 1)$$,
  'a reader who blocked an author does not count that author''s posts');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000008b2", "role": "authenticated"}', true);
select results_eq(
  $$select * from public.discussion_balance('00000000-0000-4000-8000-0000000008f1')$$,
  $$values ('b'::text, 2::bigint), ('neutral', 1)$$,
  'nor does a reader the author blocked: both directions');
reset role;

select * from finish();
rollback;
