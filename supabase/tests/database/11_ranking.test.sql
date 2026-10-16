-- Post ranking (Prompt 4.2), with votes cast through the real triggers by
-- throwaway readers who each took a side. Run with `npm run db:test`.
-- Rolls back.
--
-- The proof the prompt asks for: a one-sided popular post (20 helpful votes,
-- all from its own side) ranks below a cross-side moderate one (4 helpful
-- votes, all from the other side).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- 30 readers who agreed to the rules: 1-24 on side b, 25-30 neutral.
insert into auth.users (id, email)
  select format('00000000-0000-4000-8000-%s', lpad(to_hex(4096 + n), 12, '0'))::uuid,
         format('rank-%s@test.example', n)
    from generate_series(1, 30) n;
insert into public.profiles (id, handle, is_adult, rules_accepted_at)
  select format('00000000-0000-4000-8000-%s', lpad(to_hex(4096 + n), 12, '0'))::uuid,
         format('ranker_%s', n), true, now()
    from generate_series(1, 30) n;
-- Two authors: A writes on side a, B on side b.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000002a1', 'rank-author-a@test.example'),
  ('00000000-0000-4000-8000-0000000002b1', 'rank-author-b@test.example');
insert into public.profiles (id, handle, is_adult, rules_accepted_at) values
  ('00000000-0000-4000-8000-0000000002a1', 'author_a', true, now()),
  ('00000000-0000-4000-8000-0000000002b1', 'author_b', true, now());

insert into public.stories (id, title, category, lat, lon, published_at, discussion_state) values
  ('00000000-0000-4000-8000-0000000002f0', 'Ranked debate', 0, 41.01, 28.97, now(), 'open');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label) values
  ('00000000-0000-4000-8000-0000000002f0', 'Ranked?', 'Yes', 'No');

insert into public.discussion_stances (story_id, user_id, stance)
  select '00000000-0000-4000-8000-0000000002f0',
         format('00000000-0000-4000-8000-%s', lpad(to_hex(4096 + n), 12, '0'))::uuid,
         case when n <= 24 then 'b' else 'neutral' end
    from generate_series(1, 30) n
  union all values
  ('00000000-0000-4000-8000-0000000002f0'::uuid, '00000000-0000-4000-8000-0000000002a1'::uuid, 'a'),
  ('00000000-0000-4000-8000-0000000002f0'::uuid, '00000000-0000-4000-8000-0000000002b1'::uuid, 'b');

-- popular: B's, on side b. moderate: A's, on side a. expert and argument: two
-- of A's posts that get identical votes. neutral: a neutral reader's post.
insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state) values
  ('00000000-0000-4000-8000-0000000002e1', '00000000-0000-4000-8000-0000000002f0',
   '00000000-0000-4000-8000-0000000002b1', 'popular one-sided', 'b', 'argument', 'ok'),
  ('00000000-0000-4000-8000-0000000002e2', '00000000-0000-4000-8000-0000000002f0',
   '00000000-0000-4000-8000-0000000002a1', 'moderate cross-side', 'a', 'argument', 'ok'),
  ('00000000-0000-4000-8000-0000000002e3', '00000000-0000-4000-8000-0000000002f0',
   '00000000-0000-4000-8000-0000000002a1', 'as an expert', 'a', 'expert', 'ok'),
  ('00000000-0000-4000-8000-0000000002e4', '00000000-0000-4000-8000-0000000002f0',
   '00000000-0000-4000-8000-0000000002a1', 'as an argument', 'a', 'argument', 'ok'),
  ('00000000-0000-4000-8000-0000000002e5', '00000000-0000-4000-8000-0000000002f0',
   format('00000000-0000-4000-8000-%s', lpad(to_hex(4096 + 30), 12, '0'))::uuid,
   'neutral view', 'neutral', 'argument', 'ok');

-- Votes, inserted as the owner so the triggers alone decide each side; the
-- access rules are 10_discussions'. The voters' sides come from their stances.
create function pg_temp.reader(n integer) returns uuid language sql immutable as $$
  select format('00000000-0000-4000-8000-%s', lpad(to_hex(4096 + n), 12, '0'))::uuid;
$$;

-- Popular: 20 helpful votes from side b, its own side.
insert into public.votes (post_id, voter_id, kind)
  select '00000000-0000-4000-8000-0000000002e1', pg_temp.reader(n), 'helpful'
    from generate_series(1, 20) n;
-- Moderate: 4 helpful votes, all from side b, the other side.
insert into public.votes (post_id, voter_id, kind)
  select '00000000-0000-4000-8000-0000000002e2', pg_temp.reader(n), 'helpful'
    from generate_series(21, 24) n;

select results_eq($$select helpful_count, cross_side_count from public.posts
                     where id = '00000000-0000-4000-8000-0000000002e1'$$,
  $$values (20, 0)$$, 'the popular post: 20 helpful, none from the other side');
select results_eq($$select helpful_count, cross_side_count from public.posts
                     where id = '00000000-0000-4000-8000-0000000002e2'$$,
  $$values (4, 4)$$, 'the moderate post: 4 helpful, all from the other side');
select ok(
  (select rank_score from public.posts where id = '00000000-0000-4000-8000-0000000002e2')
  > (select rank_score from public.posts where id = '00000000-0000-4000-8000-0000000002e1'),
  'a cross-side moderate post ranks above a one-sided popular one');
select is((select array_agg(body order by rank_score desc) from public.posts
            where id in ('00000000-0000-4000-8000-0000000002e1', '00000000-0000-4000-8000-0000000002e2')),
  array['moderate cross-side', 'popular one-sided'],
  'and the discussion lists it first');
select is(round((select rank_score from public.posts
                  where id = '00000000-0000-4000-8000-0000000002e1')::numeric, 3),
  round((ln(21) * 0.5)::numeric, 3), 'popular: ln(21) * (0.5 + 0/20)');
select is(round((select rank_score from public.posts
                  where id = '00000000-0000-4000-8000-0000000002e2')::numeric, 3),
  round((ln(5) * 1.5)::numeric, 3), 'moderate: ln(5) * (0.5 + 4/4)');

-- Neutral is neither side (the owner's call).
insert into public.votes (post_id, voter_id, kind)
  select '00000000-0000-4000-8000-0000000002e2', pg_temp.reader(n), 'helpful'
    from generate_series(25, 27) n;
select results_eq($$select helpful_count, cross_side_count from public.posts
                     where id = '00000000-0000-4000-8000-0000000002e2'$$,
  $$values (7, 4)$$, 'neutral voters add helpful votes, not cross-side ones');
insert into public.votes (post_id, voter_id, kind)
  select '00000000-0000-4000-8000-0000000002e5', pg_temp.reader(n), 'helpful'
    from generate_series(1, 3) n;
select results_eq($$select helpful_count, cross_side_count from public.posts
                     where id = '00000000-0000-4000-8000-0000000002e5'$$,
  $$values (3, 0)$$, 'and a neutral post earns none from either side');

-- Changed my mind: 1.5 * ln(1 + n), on top of the helpful term.
insert into public.votes (post_id, voter_id, kind)
  select '00000000-0000-4000-8000-0000000002e1', pg_temp.reader(n), 'changed_mind'
    from generate_series(21, 22) n;
select is(round((select rank_score from public.posts
                  where id = '00000000-0000-4000-8000-0000000002e1')::numeric, 3),
  round((ln(21) * 0.5 + 1.5 * ln(3))::numeric, 3),
  'two changed-my-mind votes add 1.5 * ln(3)');

-- No boost for Expert: identical votes, identical rank.
insert into public.votes (post_id, voter_id, kind)
  select post_id::uuid, pg_temp.reader(n), kind
    from (values ('00000000-0000-4000-8000-0000000002e3'), ('00000000-0000-4000-8000-0000000002e4')) p(post_id),
         generate_series(1, 6) n,
         (values ('helpful'), ('changed_mind')) k(kind)
   where kind = 'helpful' or n <= 2;
select is((select rank_score from public.posts where id = '00000000-0000-4000-8000-0000000002e3'),
          (select rank_score from public.posts where id = '00000000-0000-4000-8000-0000000002e4'),
  'an Expert post ranks exactly level with an Argument with the same votes');
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'post_rank'),
  'p_helpful integer, p_cross_side integer, p_changed_mind integer',
  'the ranking function is given the counts and nothing else, so kind cannot reach it');
select throws_ok($$update public.posts set rank_score = 99
                    where id = '00000000-0000-4000-8000-0000000002e3'$$,
  '428C9', null, 'nobody writes a rank, not even the owner');

-- Votes that go (their voter's account was deleted) take their rank with them.
delete from auth.users where id in (select pg_temp.reader(n) from generate_series(21, 24) n);
select results_eq($$select helpful_count, cross_side_count from public.posts
                     where id = '00000000-0000-4000-8000-0000000002e2'$$,
  $$values (3, 0)$$, 'deleted voters leave the moderate post its 3 neutral votes');
select is(round((select rank_score from public.posts
                  where id = '00000000-0000-4000-8000-0000000002e2')::numeric, 3),
  round((ln(4) * 0.5)::numeric, 3), 'and its rank follows');

select * from finish();
rollback;
