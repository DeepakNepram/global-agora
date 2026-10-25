-- Appeals (Prompt 5.2): who may appeal and when, what granting and refusing
-- do, what each side can see. Run with `npm run db:test`. Rolls back.
--
-- Fixture ids:
--   fa1 M (an admin), fa2 S and fa4 T (suspended, three strikes each),
--   fa3 R (a reader in good standing)
--   discussion on story fb1; posts fc1..fc3 by S, fc4..fc6 by T
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

update private.posting_limits
   set posts_per_hour = 1000, seconds_between_posts = 0, new_account_posts_per_hour = 1000;
delete from vault.secrets where name in ('moderation_function_url', 'moderation_hook_secret');

insert into auth.users (id, email)
select ('00000000-0000-4000-8000-000000000fa' || n)::uuid, 'appeal-' || n || '@test.example'
  from generate_series(1, 4) n;
insert into public.profiles (id, handle, is_adult, rules_accepted_at)
select ('00000000-0000-4000-8000-000000000fa' || n)::uuid, 'appeal_' || n, true, now()
  from generate_series(1, 4) n;
insert into public.admins (user_id) values ('00000000-0000-4000-8000-000000000fa1');
insert into public.stories (id, title, category, lat, lon, published_at, discussion_state) values
  ('00000000-0000-4000-8000-000000000fb1', 'Appealed debate', 0, 41.01, 28.97, now(), 'open');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label) values
  ('00000000-0000-4000-8000-000000000fb1', 'Appealed?', 'Yes', 'No');
insert into public.discussion_stances (story_id, user_id, stance) values
  ('00000000-0000-4000-8000-000000000fb1', '00000000-0000-4000-8000-000000000fa2', 'a'),
  ('00000000-0000-4000-8000-000000000fb1', '00000000-0000-4000-8000-000000000fa4', 'b');
insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state)
select ('00000000-0000-4000-8000-000000000fc' || n)::uuid, '00000000-0000-4000-8000-000000000fb1',
       case when n <= 3 then '00000000-0000-4000-8000-000000000fa2'
            else '00000000-0000-4000-8000-000000000fa4' end::uuid,
       'removed post ' || n, case when n <= 3 then 'a' else 'b' end, 'argument', 'removed'
  from generate_series(1, 6) n;
insert into public.strikes (user_id, post_id, source)
select p.author_id, p.id, 'auto' from public.posts p
 where p.story_id = '00000000-0000-4000-8000-000000000fb1';

-- ---------------------------------------------------------------------------
-- The fixtures, and the settings.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select strikes, suspended_at is not null from public.profiles
     where id = '00000000-0000-4000-8000-000000000fa2'$$,
  $$values (3::smallint, true)$$,
  'three strikes suspended S');
select is((select refusal_wait from private.appeal_settings), interval '30 days',
  'after a refusal, 30 days before another appeal (a setting)');
select throws_ok('insert into private.appeal_settings default values', '23505', null,
  'there is one settings row');

-- ---------------------------------------------------------------------------
-- Who may appeal.
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select public.submit_appeal('let me back')$$, '42501', null,
  'a guest cannot appeal');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000fa3", "role": "authenticated"}', true);
select throws_ok($$select public.submit_appeal('nothing to appeal')$$, '55000',
  'only a suspended account can appeal', 'an account in good standing has nothing to appeal');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000fa2", "role": "authenticated"}', true);
select throws_ok($$select public.submit_appeal('   ')$$, '22023', null, 'an empty appeal is refused');
select throws_ok($$select public.submit_appeal(repeat('x', 1001))$$, '22023', null,
  'so is one over 1000 characters');
select isnt(public.submit_appeal('  The second post was quoting the article.  '), null,
  'a suspended account appeals');
select is((select body from public.appeals), 'The second post was quoting the article.',
  'its words are kept, trimmed');
select throws_ok($$select public.submit_appeal('and again')$$, '23505', null,
  'one waiting appeal at a time');
select results_eq(
  $$select appeal_status, appeal_sent_at is not null, appeal_reply, appeal_again_at
      from public.my_profile()$$,
  $$values ('pending'::text, true, null::text, null::timestamptz)$$,
  'my_profile says it is waiting');
select throws_ok($$insert into public.appeals (user_id, body)
                   values ('00000000-0000-4000-8000-000000000fa2', 'direct')$$,
  '42501', null, 'nobody writes an appeal but through submit_appeal');
select throws_ok($$update public.appeals set status = 'granted'$$, '42501', null,
  'nor grants one to themselves');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000fa3", "role": "authenticated"}', true);
select is((select count(*) from public.appeals), 0::bigint, 'nobody reads another account''s appeal');
select throws_ok('select * from public.admin_appeals()', '42501', 'moderators only',
  'a reader cannot see the moderators'' list');
select throws_ok($$select public.decide_appeal(gen_random_uuid(), true, 'ok')$$, '42501',
  'moderators only', 'or decide an appeal');

-- ---------------------------------------------------------------------------
-- The moderators' list.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000fa1", "role": "authenticated"}', true);
select results_eq(
  $$select handle, status, strikes, suspended_at is not null, jsonb_array_length(removed_posts)
      from public.admin_appeals()$$,
  $$values ('appeal_2'::text, 'pending'::text, 3::smallint, true, 3)$$,
  'a moderator sees the appeal, the account''s strikes and the posts behind them');
select ok(
  (select removed_posts @> '[{"body": "removed post 2"}]' from public.admin_appeals() limit 1),
  'with the removed posts'' text');

-- ---------------------------------------------------------------------------
-- Granting.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.decide_appeal((select a.id from public.admin_appeals() a limit 1), true, '  ')$$,
  '22023', null, 'a decision needs a reply');
select is(
  public.decide_appeal((select a.id from public.admin_appeals() a where a.status = 'pending'),
                       true, 'You are right: it was a quotation.'),
  'granted', 'M grants it');
reset role;
select results_eq(
  $$select strikes, suspended_at from public.profiles
     where id = '00000000-0000-4000-8000-000000000fa2'$$,
  $$values (0::smallint, null::timestamptz)$$,
  'granted: the suspension ends and no strike counts');
select results_eq(
  $$select count(*), count(overturned_at), count(overturned_by) from public.strikes
     where user_id = '00000000-0000-4000-8000-000000000fa2'$$,
  $$values (3::bigint, 3::bigint, 3::bigint)$$,
  'the strikes stay on record, overturned by M');
select is(
  (select mod_state from public.posts where id = '00000000-0000-4000-8000-000000000fc2'),
  'removed', 'the removed posts stay removed');
select results_eq(
  $$select kind, detail from public.notifications
     where user_id = '00000000-0000-4000-8000-000000000fa2' and kind = 'appeal_outcome'$$,
  $$values ('appeal_outcome'::text,
            '{"granted": true, "reply": "You are right: it was a quotation."}'::jsonb)$$,
  'S hears the outcome and the reply');
select is(
  (select action from public.admin_actions order by id desc limit 1), 'grant_appeal',
  'the decision is in the admin log');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000fa1", "role": "authenticated"}', true);
select throws_ok(
  $$select public.decide_appeal((select a.id from public.admin_appeals() a limit 1), false,
                                'changed my mind')$$,
  '55000', 'already decided', 'a decision is final');
reset role;

-- A new strike after a granted appeal starts from nothing: no suspension.
insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state) values
  ('00000000-0000-4000-8000-000000000fd1', '00000000-0000-4000-8000-000000000fb1',
   '00000000-0000-4000-8000-000000000fa2', 'a new removed post', 'a', 'argument', 'removed');
insert into public.strikes (user_id, post_id, source)
values ('00000000-0000-4000-8000-000000000fa2', '00000000-0000-4000-8000-000000000fd1', 'auto');
select results_eq(
  $$select strikes, suspended_at is null from public.profiles
     where id = '00000000-0000-4000-8000-000000000fa2'$$,
  $$values (1::smallint, true)$$,
  'after a grant, a new strike is the first that counts');

-- ---------------------------------------------------------------------------
-- Refusing, and the wait.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000fa4", "role": "authenticated"}', true);
select isnt(public.submit_appeal('Please look again.'), null, 'T appeals');
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000fa1", "role": "authenticated"}', true);
select is(
  public.decide_appeal((select a.id from public.admin_appeals() a where a.status = 'pending'),
                       false, 'The posts broke rule 1.'),
  'refused', 'M refuses it');
select is(
  (select a.status from public.admin_appeals() a where a.handle = 'appeal_4'), 'refused',
  'decided appeals stay on the list');
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000fa4", "role": "authenticated"}', true);
select results_eq(
  $$select appeal_status, appeal_reply,
           appeal_again_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'
      from public.my_profile()$$,
  $$values ('refused'::text, 'The posts broke rule 1.'::text, true)$$,
  'my_profile gives the reply and when T may appeal again');
select is((select suspended_at is not null from public.my_profile()), true,
  'refused: still suspended');
select throws_ok($$select public.submit_appeal('Again, please.')$$, '55000',
  'too soon after a refusal', 'not again before the wait is over');
reset role;
update public.appeals set decided_at = now() - interval '31 days'
 where user_id = '00000000-0000-4000-8000-000000000fa4';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000fa4", "role": "authenticated"}', true);
select isnt(public.submit_appeal('A month on: please look again.'), null,
  'after the wait, another appeal');
reset role;

-- ---------------------------------------------------------------------------
-- Deleting the account deletes its appeals.
-- ---------------------------------------------------------------------------
delete from auth.users where id = '00000000-0000-4000-8000-000000000fa4';
select is(
  (select count(*) from public.appeals where user_id = '00000000-0000-4000-8000-000000000fa4'),
  0::bigint, 'deleting an account deletes its appeals');
select is(
  (select count(*) from public.appeals where user_id = '00000000-0000-4000-8000-000000000fa2'),
  1::bigint, 'and nobody else''s');

select * from finish();
rollback;
