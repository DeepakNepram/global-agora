-- Follows and saved stories (Prompt 3.4): each reader sees, adds and removes
-- only their own; the shapes are checked; the abuse bound holds; deleting an
-- account deletes them. Run with `npm run db:test`. The transaction rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000aa', 'library-a@test.example'),
  ('00000000-0000-4000-8000-0000000000bb', 'library-b@test.example');

-- Reader B already follows Japan and saved story 900.
insert into public.follows (user_id, kind, target, label) values
  ('00000000-0000-4000-8000-0000000000bb', 'place', 'country:JP', 'Japan');
insert into public.saved_stories (user_id, story_seq, headline, published_at) values
  ('00000000-0000-4000-8000-0000000000bb', 900, 'B''s saved story', now());

-- ---------------------------------------------------------------------------
-- Signed out: nothing.
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select * from public.follows $$, '42501', null, 'anon cannot read follows');
select throws_ok($$ select * from public.saved_stories $$, '42501', null,
                 'anon cannot read saved stories');
reset role;

-- ---------------------------------------------------------------------------
-- Signed in as reader A.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000aa", "role": "authenticated"}', true);

select lives_ok($$
  insert into public.follows (kind, target, label, baseline) values
    ('place', 'city:1159151609', 'Tokyo, Japan', null),
    ('category', 'climate', 'Climate', null),
    ('story', '23904', 'Vote nears in London', 12)
$$, 'A follows a city, a category and a story; user_id fills itself in');
select lives_ok($$
  insert into public.saved_stories (story_seq, headline, place, published_at)
  values (23904, 'Vote nears in London', 'London, United Kingdom', now())
$$, 'A saves a story');
select is((select count(*) from public.follows), 3::bigint, 'A reads only A''s follows');
select is((select count(*) from public.saved_stories), 1::bigint, 'A reads only A''s saves');
select is((select user_id::text from public.follows limit 1),
          '00000000-0000-4000-8000-0000000000aa', 'the follow is A''s');

-- Moving a device's lists up twice merges: the second insert changes nothing.
select lives_ok($$
  insert into public.follows (kind, target, label) values ('category', 'climate', 'Climate')
  on conflict do nothing
$$, 'a repeated follow is ignored, not an error');
select is((select count(*) from public.follows), 3::bigint, 'still three follows');

select throws_ok($$
  insert into public.follows (user_id, kind, target, label)
  values ('00000000-0000-4000-8000-0000000000bb', 'category', 'tech', 'Tech')
$$, '42501', null, 'A cannot follow on B''s behalf');
select throws_ok($$
  insert into public.saved_stories (user_id, story_seq, headline, published_at)
  values ('00000000-0000-4000-8000-0000000000bb', 1, 'x', now())
$$, '42501', null, 'A cannot save on B''s behalf');

select throws_ok($$ update public.follows set label = 'x' $$, '42501', null,
                 'follows are added or removed, never edited');

-- Shapes: one spelling per target, and no coordinates.
select throws_ok($$ insert into public.follows (kind, target, label) values ('place', '51.5,-0.1', 'London') $$,
                 '23514', null, 'a place is an id, never coordinates');
select throws_ok($$ insert into public.follows (kind, target, label) values ('category', 'gossip', 'Gossip') $$,
                 '23514', null, 'a category must be one of the eight');
select throws_ok($$ insert into public.follows (kind, target, label) values ('story', '0', 'x') $$,
                 '23514', null, 'a story is a payload id');
select throws_ok($$ insert into public.saved_stories (story_seq, headline, published_at) values (5, '', now()) $$,
                 '23514', null, 'a save keeps its headline');

-- Removing.
delete from public.follows where kind = 'story';
select is((select count(*) from public.follows), 2::bigint, 'A unfollows a story');
reset role;

select is((select count(*) from public.follows
            where user_id = '00000000-0000-4000-8000-0000000000bb'), 1::bigint,
          'B''s follow is untouched by A');

-- The abuse bound: 1,000 rows each, even within one insert.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000000aa", "role": "authenticated"}', true);
select lives_ok($$
  insert into public.saved_stories (story_seq, headline, published_at)
  select 100000 + g, 'bulk', now() from generate_series(1, 999) g
$$, 'up to 1,000 saves');
select throws_ok($$
  insert into public.saved_stories (story_seq, headline, published_at) values (99, 'one more', now())
$$, '54000', null, 'the 1,001st is refused');
reset role;

-- Deleting an account deletes its lists.
delete from auth.users where id = '00000000-0000-4000-8000-0000000000aa';
select is((select count(*) from public.follows
            where user_id = '00000000-0000-4000-8000-0000000000aa'), 0::bigint,
          'account deletion removes its follows');
select is((select count(*) from public.saved_stories
            where user_id = '00000000-0000-4000-8000-0000000000aa'), 0::bigint,
          'account deletion removes its saves');

select * from finish();
rollback;
