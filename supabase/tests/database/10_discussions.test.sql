-- Discussions (Prompt 4.2): stances, posting, voting, the counts, and what
-- each kind of reader can see. Run with `npm run db:test`. Rolls back.
--
-- Fixture ids:
--   readers a1 (A), a2 (B), a3 (C, has not agreed to the rules), a4 (D, blocked A)
--   discussions on stories b1 (open), b2 (open but past its close time),
--   b3 (closed)
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- Fixtures write several posts per author at once; the posting limits have
-- their own test (15_posting_limits).
update private.posting_limits
   set posts_per_hour = 1000, seconds_between_posts = 0, new_account_posts_per_hour = 1000;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'disc-a@test.example'),
  ('00000000-0000-4000-8000-0000000000a2', 'disc-b@test.example'),
  ('00000000-0000-4000-8000-0000000000a3', 'disc-c@test.example'),
  ('00000000-0000-4000-8000-0000000000a4', 'disc-d@test.example');
insert into public.profiles (id, handle, is_adult, rules_accepted_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'reader_a', true, now()),
  ('00000000-0000-4000-8000-0000000000a2', 'reader_b', true, now()),
  ('00000000-0000-4000-8000-0000000000a3', 'reader_c', true, null),
  ('00000000-0000-4000-8000-0000000000a4', 'reader_d', true, now());
insert into public.stories (id, title, category, lat, lon, published_at, discussion_state) values
  ('00000000-0000-4000-8000-0000000000b1', 'Open debate', 0, 41.01, 28.97, now(), 'open'),
  ('00000000-0000-4000-8000-0000000000b2', 'Overdue debate', 0, 48.85, 2.35, now(), 'open'),
  ('00000000-0000-4000-8000-0000000000b3', 'Closed debate', 0, 51.51, -0.13, now(), 'closed');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label, opened_at, closes_at, state) values
  ('00000000-0000-4000-8000-0000000000b1', 'Open?', 'Yes', 'No', now(), now() + interval '48 hours', 'open'),
  ('00000000-0000-4000-8000-0000000000b2', 'Overdue?', 'Yes', 'No', now() - interval '3 days',
   now() - interval '1 day', 'open'),
  ('00000000-0000-4000-8000-0000000000b3', 'Closed?', 'Yes', 'No', now() - interval '3 days',
   now() - interval '1 day', 'closed');
-- D blocked A. A and B already hold sides in the overdue and closed debates
-- (taken while they were open), so only the time decides there.
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a1');
insert into public.discussion_stances (story_id, user_id, stance) values
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', 'a'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a1', 'a');
-- An approved post in the overdue debate, for voting after the close time.
insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b2',
   '00000000-0000-4000-8000-0000000000a2', 'overdue post by b', 'b', 'argument', 'ok');

-- Clients cannot choose a post's id, so the owner notes each new one here.
create temp table ids (name text primary key, id uuid not null) on commit drop;
grant select on ids to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Signed out: discussions and approved posts, nothing else.
-- ---------------------------------------------------------------------------
set local role anon;
select is((select count(*) from public.discussions), 3::bigint, 'anon reads discussions');
select is((select array_agg(body) from public.posts), array['overdue post by b'],
  'anon reads approved posts');
select throws_ok('select mod_scores from public.posts', '42501', null,
  'anon never reads moderation scores');
select throws_ok($$insert into public.discussion_stances (story_id, stance)
                   values ('00000000-0000-4000-8000-0000000000b1', 'a')$$,
  '42501', null, 'anon cannot take a side');
select throws_ok($$insert into public.posts (story_id, body, kind)
                   values ('00000000-0000-4000-8000-0000000000b1', 'hi', 'argument')$$,
  '42501', null, 'anon cannot post');
reset role;

-- ---------------------------------------------------------------------------
-- Reader A takes a side and posts.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}', true);

select throws_ok($$insert into public.posts (story_id, body, kind)
                   values ('00000000-0000-4000-8000-0000000000b1', 'no side yet', 'argument')$$,
  '42501', null, 'no post before taking a side');
select lives_ok($$insert into public.discussion_stances (story_id, stance)
                  values ('00000000-0000-4000-8000-0000000000b1', 'b')$$,
  'A takes a side');
select throws_ok($$insert into public.discussion_stances (story_id, user_id, stance)
                   values ('00000000-0000-4000-8000-0000000000b1',
                           '00000000-0000-4000-8000-0000000000a2', 'a')$$,
  '42501', null, 'A cannot take a side for B');
select lives_ok($$update public.discussion_stances set stance = 'a'
                  where story_id = '00000000-0000-4000-8000-0000000000b1'$$,
  'A changes sides before posting');
select throws_ok($$insert into public.discussion_stances (story_id, stance)
                   values ('00000000-0000-4000-8000-0000000000b3', 'a')$$,
  '42501', null, 'no side taken in a closed discussion');

select lives_ok($$insert into public.posts (story_id, body, kind)
                  values ('00000000-0000-4000-8000-0000000000b1', 'post by a', 'argument')$$,
  'A posts without naming a side');
select results_eq($$select author_id::text, stance, mod_state from public.posts
                     where body = 'post by a'$$,
  $$values ('00000000-0000-4000-8000-0000000000a1'::text, 'a'::text, 'pending'::text)$$,
  'the post is A''s, on A''s side, and waits for moderation');
select is((select locked_at is not null from public.discussion_stances
            where story_id = '00000000-0000-4000-8000-0000000000b1'), true,
  'posting fixes A''s side');
update public.discussion_stances set stance = 'b'
 where story_id = '00000000-0000-4000-8000-0000000000b1';
select is((select stance from public.discussion_stances
            where story_id = '00000000-0000-4000-8000-0000000000b1'), 'a',
  'and A cannot change it afterwards');

select throws_ok($$insert into public.posts (story_id, body, stance, kind)
                   values ('00000000-0000-4000-8000-0000000000b1', 'other side', 'b', 'argument')$$,
  '42501', null, 'A cannot post for the other side');
select throws_ok($$insert into public.posts (story_id, body, kind, mod_state)
                   values ('00000000-0000-4000-8000-0000000000b1', 'self-approved', 'argument', 'ok')$$,
  '42501', null, 'A cannot approve their own post');
select throws_ok($$insert into public.posts (story_id, body, kind, region_label)
                   values ('00000000-0000-4000-8000-0000000000b1', 'labelled', 'argument', 'Paris area')$$,
  '42501', null, 'A cannot write a region label (Prompt 4.4''s Worker does)');
select throws_ok($$insert into public.posts (story_id, author_id, body, kind)
                   values ('00000000-0000-4000-8000-0000000000b1',
                           '00000000-0000-4000-8000-0000000000a2', 'as b', 'argument')$$,
  '42501', null, 'A cannot post as B');
select throws_ok('select mod_scores from public.posts', '42501', null,
  'A cannot read moderation scores, their own included');
select throws_ok($$update public.posts set body = 'edited'$$, '42501', null,
  'posts cannot be edited');
select throws_ok('delete from public.posts', '42501', null, 'or deleted by a client');
select throws_ok($$insert into public.posts (story_id, body, kind)
                   values ('00000000-0000-4000-8000-0000000000b2', 'too late', 'argument')$$,
  '42501', null, 'no post after the close time, before the close job runs');
select throws_ok($$insert into public.posts (story_id, body, kind)
                   values ('00000000-0000-4000-8000-0000000000b3', 'closed', 'argument')$$,
  '42501', null, 'no post in a closed discussion');

-- ---------------------------------------------------------------------------
-- Reader C has not agreed to the rules.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated"}', true);
select throws_ok($$insert into public.discussion_stances (story_id, stance)
                   values ('00000000-0000-4000-8000-0000000000b1', 'a')$$,
  '42501', null, 'no side without agreeing to the rules');

-- ---------------------------------------------------------------------------
-- Reader B posts; the moderator (here, the owner) approves both posts.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}', true);
insert into public.discussion_stances (story_id, stance)
  values ('00000000-0000-4000-8000-0000000000b1', 'b');
insert into public.posts (story_id, body, kind)
  values ('00000000-0000-4000-8000-0000000000b1', 'post by b', 'argument'),
         ('00000000-0000-4000-8000-0000000000b1', 'pending post by b', 'argument');
reset role;
insert into ids
  select 'c1', id from public.posts where body = 'post by a'
  union all select 'c3', id from public.posts where body = 'post by b'
  union all select 'c4', id from public.posts where body = 'pending post by b';
update public.posts set mod_state = 'ok' where body in ('post by a', 'post by b');
select is((select post_count from public.discussions
            where story_id = '00000000-0000-4000-8000-0000000000b1'), 2,
  'post_count counts the approved posts');

-- ---------------------------------------------------------------------------
-- Reader B votes.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}', true);
select lives_ok($$insert into public.votes (post_id, kind)
                  values ((select id from ids where name = 'c1'), 'helpful')$$,
  'B finds A''s post helpful');
select is((select voter_stance from public.votes
            where post_id = (select id from ids where name = 'c1')), 'b',
  'the vote carries B''s recorded side');
select results_eq($$select helpful_count, cross_side_count, changed_mind_count from public.posts
                     where id = (select id from ids where name = 'c1')$$,
  $$values (1, 1, 0)$$,
  'a helpful vote from the other side counts as cross-side');
select throws_ok($$insert into public.votes (post_id, kind)
                   values ((select id from ids where name = 'c1'), 'helpful')$$,
  '23505', null, 'one helpful vote per person and post');
select lives_ok($$insert into public.votes (post_id, kind)
                  values ((select id from ids where name = 'c1'), 'changed_mind')$$,
  'and, separately, one changed-my-mind');
select results_eq($$select helpful_count, cross_side_count, changed_mind_count from public.posts
                     where id = (select id from ids where name = 'c1')$$,
  $$values (1, 1, 1)$$,
  'changed-my-mind counts apart from helpful and cross-side');
select throws_ok($$insert into public.votes (post_id, kind)
                   values ((select id from ids where name = 'c3'), 'helpful')$$,
  '42501', null, 'B cannot vote on their own post');
select throws_ok($$insert into public.votes (post_id, kind)
                   values ((select id from ids where name = 'c4'), 'helpful')$$,
  '42501', null, 'nor on one waiting for moderation');
select throws_ok($$insert into public.votes (post_id, kind, voter_stance)
                   values ((select id from ids where name = 'c1'), 'helpful', 'a')$$,
  '42501', null, 'B cannot send the side a vote counts with');
select throws_ok($$insert into public.votes (post_id, voter_id, kind)
                   values ((select id from ids where name = 'c1'),
                           '00000000-0000-4000-8000-0000000000a4', 'helpful')$$,
  '42501', null, 'B cannot vote as D');
select throws_ok($$update public.posts set helpful_count = 100$$, '42501', null,
  'B cannot write a count');

-- ---------------------------------------------------------------------------
-- Reader A votes past the close time; reader D blocked A.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}', true);
select throws_ok($$insert into public.votes (post_id, kind)
                   values ('00000000-0000-4000-8000-0000000000c2', 'helpful')$$,
  '42501', null, 'no voting after the close time');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000a4", "role": "authenticated"}', true);
select is((select count(*) from public.posts
            where author_id = '00000000-0000-4000-8000-0000000000a1'), 0::bigint,
  'D, who blocked A, sees none of A''s posts');
select is((select count(*) from public.posts
            where author_id = '00000000-0000-4000-8000-0000000000a2'), 2::bigint,
  'but sees B''s approved ones');
insert into public.discussion_stances (story_id, stance)
  values ('00000000-0000-4000-8000-0000000000b1', 'neutral');
select throws_ok($$insert into public.votes (post_id, kind)
                   values ((select id from ids where name = 'c1'), 'helpful')$$,
  '42501', null, 'D cannot vote on a post by someone D blocked');
select lives_ok($$insert into public.votes (post_id, kind)
                  values ((select id from ids where name = 'c3'), 'helpful')$$,
  'D, neutral, finds B''s post helpful');
select results_eq($$select helpful_count, cross_side_count from public.posts
                     where id = (select id from ids where name = 'c3')$$,
  $$values (1, 0)$$,
  'a neutral voter is not the other side');
select is((select count(*) from public.votes), 1::bigint, 'D reads only D''s own votes');
select throws_ok('select 1 from public.reports', '42501', null,
  'and nobody but the service role reads reports');

-- ---------------------------------------------------------------------------
-- Afterwards, as the owner.
-- ---------------------------------------------------------------------------
reset role;
update public.posts set mod_state = 'hidden' where id = (select id from ids where name = 'c3');
select is((select post_count from public.discussions
            where story_id = '00000000-0000-4000-8000-0000000000b1'), 1,
  'hiding a post takes it out of post_count');
select is((select locked_at is not null from public.discussion_stances
            where story_id = '00000000-0000-4000-8000-0000000000b1'
              and user_id = '00000000-0000-4000-8000-0000000000a4'), true,
  'voting fixes D''s side too');

-- D deletes their account: their vote goes, and so does its count.
delete from auth.users where id = '00000000-0000-4000-8000-0000000000a4';
select is((select helpful_count from public.posts
            where id = (select id from ids where name = 'c3')), 0,
  'a deleted account''s votes leave the counts');
-- B deletes theirs: A's post loses B's helpful, cross-side and changed-my-mind.
delete from auth.users where id = '00000000-0000-4000-8000-0000000000a2';
select results_eq($$select helpful_count, cross_side_count, changed_mind_count from public.posts
                     where id = (select id from ids where name = 'c1')$$,
  $$values (0, 0, 0)$$,
  'the counts are always the votes that exist');

select * from finish();
rollback;
