-- Profiles (Prompt 4.1): public fields by column, the first sign-in's flow
-- through its functions, isolation between readers, and account deletion
-- that removes everything but the moderation record. Run with
-- `npm run db:test`. The transaction rolls back.
--
-- Fixture ids: ...c1 reader A (no profile yet), ...c2 reader B, ...c3 reader C
-- (holds the handle taken_one).
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'profile-a@test.example'),
  ('00000000-0000-4000-8000-0000000000c2', 'profile-b@test.example'),
  ('00000000-0000-4000-8000-0000000000c3', 'profile-c@test.example');
insert into public.profiles (id, handle, is_adult, rules_accepted_at, strikes) values
  ('00000000-0000-4000-8000-0000000000c3', 'taken_one', true, now(), 1);

-- ---------------------------------------------------------------------------
-- The table's own rules, as the owner.
-- ---------------------------------------------------------------------------
select throws_ok($$insert into public.profiles (id, handle)
                   values ('00000000-0000-4000-8000-0000000000c2', 'Upper_case')$$,
  '23514', null, 'a handle is lower case');
select throws_ok($$insert into public.profiles (id, handle)
                   values ('00000000-0000-4000-8000-0000000000c2', '9lives')$$,
  '23514', null, 'a handle starts with a letter');
select throws_ok($$insert into public.profiles (id, handle)
                   values ('00000000-0000-4000-8000-0000000000c2', 'ab')$$,
  '23514', null, 'a handle has at least three characters');
select throws_ok($$insert into public.profiles (id, handle)
                   values ('00000000-0000-4000-8000-0000000000c2', 'moderator')$$,
  '23514', null, 'a reserved word is not a handle');
select throws_ok($$insert into public.profiles (id, handle)
                   values ('00000000-0000-4000-8000-0000000000c2', 'agora_news')$$,
  '23514', null, 'nor is a handle starting with a reserved prefix');

-- ---------------------------------------------------------------------------
-- Signed out: public fields only, and none of the flow.
-- ---------------------------------------------------------------------------
set local role anon;

select is((select handle from public.profiles where id = '00000000-0000-4000-8000-0000000000c3'),
  'taken_one', 'anon reads a handle');
select throws_ok('select strikes from public.profiles', '42501', null, 'anon cannot read strikes');
select throws_ok('select * from public.profiles', '42501', null,
  'anon cannot read every column at once');
select throws_ok($$select public.handles_available(array['free_one'])$$, '42501', null,
  'anon cannot check handles');
select throws_ok($$select public.claim_handle('free_one', true)$$, '42501', null,
  'anon cannot claim a handle');
select throws_ok('select public.accept_rules()', '42501', null, 'anon cannot accept the rules');
select throws_ok('select * from public.my_profile()', '42501', null, 'anon has no profile to read');
select throws_ok('select public.delete_my_account()', '42501', null, 'anon cannot delete accounts');

reset role;

-- ---------------------------------------------------------------------------
-- Reader A's first sign-in.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}', true);

select throws_ok('select tier from public.profiles', '42501', null,
  'signed in: cannot read anyone''s tier from the table');
select throws_ok($$insert into public.profiles (id, handle)
                   values ('00000000-0000-4000-8000-0000000000c1', 'direct_write')$$,
  '42501', null, 'signed in: cannot write the table directly');
select throws_ok($$update public.profiles set strikes = 0$$, '42501', null,
  'signed in: cannot clear strikes');

select is((select count(*) from public.my_profile()), 0::bigint, 'no profile before the flow');
select throws_ok('select public.accept_rules()', '55000', null,
  'the rules come after the handle');

select is(
  public.handles_available(array['taken_one', 'free_one', 'Free_two', 'admin', 'ab',
                                 'support_desk', 'fresh_heron_42']),
  array['free_one', 'fresh_heron_42'],
  'handles_available keeps the valid, unreserved, untaken ones, in order');
select is(cardinality(public.handles_available(array[
    'aaa1', 'aaa2', 'aaa3', 'aaa4', 'aaa5', 'aaa6', 'aaa7', 'aaa8', 'aaa9', 'aaa10', 'aaa11'])),
  10, 'and looks at ten at most');

select throws_ok($$select public.claim_handle('heron_one', false)$$, '22023', null,
  'no profile without the 17+ confirmation');
select throws_ok($$select public.claim_handle('heron_one', null)$$, '22023', null,
  'nor with it unanswered');
select throws_ok($$select public.claim_handle('Heron One', true)$$, '22023', null,
  'an invalid handle is refused');
select throws_ok($$select public.claim_handle('staff_pick', true)$$, '22023', null,
  'a reserved handle is refused');
select throws_ok($$select public.claim_handle('taken_one', true)$$, '23505', null,
  'a taken handle is refused');

select is(public.claim_handle('heron_one', true), 'heron_one', 'A claims a handle');
select results_eq('select handle, is_adult, rules_accepted_at is null from public.my_profile()',
  $$values ('heron_one'::text, true, true)$$,
  'my_profile: the handle, the 17+ answer, rules not yet agreed');

select is(public.claim_handle('heron_two', true), 'heron_two', 'Back, then a different handle');
select is((select count(*) from public.profiles
            where id = '00000000-0000-4000-8000-0000000000c1'), 1::bigint,
  'still one profile');
select is(public.handles_available(array['heron_one']), array['heron_one'],
  'the first handle is free again');

select isnt(public.accept_rules(), null, '"I agree" records the time');
select ok((select rules_accepted_at is not null from public.my_profile()), 'and my_profile has it');
select throws_ok($$select public.claim_handle('heron_three', true)$$, '55000', null,
  'once the rules are agreed, the handle stays');

-- ---------------------------------------------------------------------------
-- Reader B sees A's public fields, nothing private, and none of A's state.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}', true);

select is((select handle from public.profiles where id = '00000000-0000-4000-8000-0000000000c1'),
  'heron_two', 'B reads A''s handle');
select throws_ok('select is_adult from public.profiles', '42501', null,
  'B cannot read A''s 17+ answer');
select is((select count(*) from public.my_profile()), 0::bigint, 'B has no profile of their own yet');
select throws_ok('select public.accept_rules()', '55000', null,
  'B cannot agree for a profile B does not have');

reset role;

-- ---------------------------------------------------------------------------
-- Deleting A's account. A has a post, a vote, blocks both ways, a report, a
-- follow and a save; B (set up here by the owner) has a post A voted on.
-- ---------------------------------------------------------------------------
insert into public.profiles (id, handle, is_adult, rules_accepted_at) values
  ('00000000-0000-4000-8000-0000000000c2', 'reader_b', true, now());
insert into public.stories (id, title, category, lat, lon, published_at) values
  ('00000000-0000-4000-8000-000000000071', 'Debated story', 0, 41.01, 28.97, now());
insert into public.discussions (story_id, prompt, side_a_label, side_b_label, closes_at) values
  ('00000000-0000-4000-8000-000000000071', 'Fixture prompt?', 'Yes', 'No', now() + interval '48 hours');
insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000071',
   '00000000-0000-4000-8000-0000000000c1', 'post by a', 'a', 'argument', 'ok'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-000000000071',
   '00000000-0000-4000-8000-0000000000c2', 'post by b', 'b', 'argument', 'ok');
insert into public.votes (post_id, voter_id, kind, voter_stance) values
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000c1', 'helpful', 'a');
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c3'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c1');
insert into public.reports (id, post_id, reporter_id, reason) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f2',
   '00000000-0000-4000-8000-0000000000c1', 'spam');
insert into public.follows (user_id, kind, target, label) values
  ('00000000-0000-4000-8000-0000000000c1', 'category', 'climate', 'Climate');
insert into public.saved_stories (user_id, story_seq, headline, published_at) values
  ('00000000-0000-4000-8000-0000000000c1', 900, 'A''s saved story', now());

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}', true);
select lives_ok('select public.delete_my_account()', 'A deletes their account');
reset role;

select is((select count(*) from auth.users where id = '00000000-0000-4000-8000-0000000000c1'),
  0::bigint, 'the auth user is gone');
select is(
  (select count(*) from public.profiles where id = '00000000-0000-4000-8000-0000000000c1')
  + (select count(*) from public.follows where user_id = '00000000-0000-4000-8000-0000000000c1')
  + (select count(*) from public.saved_stories where user_id = '00000000-0000-4000-8000-0000000000c1'),
  0::bigint, 'and the profile, follows and saves');
select is(
  (select count(*) from public.posts where author_id = '00000000-0000-4000-8000-0000000000c1')
  + (select count(*) from public.votes where voter_id = '00000000-0000-4000-8000-0000000000c1')
  + (select count(*) from public.blocks
      where '00000000-0000-4000-8000-0000000000c1' in (blocker_id, blocked_id)),
  0::bigint, 'and their posts, votes and blocks either way');
select is((select reporter_id from public.reports where id = '00000000-0000-4000-8000-0000000000d1'),
  null, 'the report stays, without the reporter');
select is((select count(*) from public.posts where author_id = '00000000-0000-4000-8000-0000000000c2'),
  1::bigint, 'B''s post A voted on stays');

select * from finish();
rollback;
