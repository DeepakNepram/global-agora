-- Moderation (Prompt 4.3): the decision from the models' signals, its
-- consequences (strikes, suspension, the author's notice), the hand-off to
-- the Edge Function through pg_net, and the retry sweep. The function and
-- the models themselves are checked by db:smoke. Run with `npm run db:test`.
--
-- Fixture ids:
--   readers 4a1 (author), 4a2 (another reader)
--   discussions on stories 4b1 and 4b2; posts 4c1..4c9 by 4a1, 4d1 by 4a2
begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

-- Fixtures write several posts per author at once; the posting limits have
-- their own test (15_posting_limits).
update private.posting_limits
   set posts_per_hour = 1000, seconds_between_posts = 0, new_account_posts_per_hour = 1000;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000004a1', 'mod-author@test.example'),
  ('00000000-0000-4000-8000-0000000004a2', 'mod-reader@test.example');
insert into public.profiles (id, handle, is_adult, rules_accepted_at) values
  ('00000000-0000-4000-8000-0000000004a1', 'mod_author', true, now()),
  ('00000000-0000-4000-8000-0000000004a2', 'mod_reader', true, now());
insert into public.stories (id, title, category, lat, lon, published_at, discussion_state) values
  ('00000000-0000-4000-8000-0000000004b1', 'Moderated debate', 0, 41.01, 28.97, now(), 'open');
insert into public.stories (id, title, category, lat, lon, published_at, discussion_state) values
  ('00000000-0000-4000-8000-0000000004b2', 'Another debate', 0, 48.85, 2.35, now(), 'open');
insert into public.discussions (story_id, prompt, side_a_label, side_b_label) values
  ('00000000-0000-4000-8000-0000000004b1', 'Moderated?', 'Yes', 'No'),
  ('00000000-0000-4000-8000-0000000004b2', 'Another?', 'Yes', 'No');
insert into public.discussion_stances (story_id, user_id, stance) values
  ('00000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-0000000004a1', 'a'),
  ('00000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-0000000004a2', 'b');

-- The hand-off is checked below with its own Vault entries; until then none,
-- whatever the local seed holds.
delete from vault.secrets where name in ('moderation_function_url', 'moderation_hook_secret');

insert into public.posts (id, story_id, author_id, body, stance, kind)
select ('00000000-0000-4000-8000-0000000004c' || n)::uuid,
       '00000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-0000000004a1',
       'post ' || n, 'a', 'argument'
  from generate_series(1, 9) n;

-- ---------------------------------------------------------------------------
-- Settings: config values, not literals, and never nonsense.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select toxicity_hide_at, toxicity_remove_above, strikes_to_suspend, max_attempts
      from private.moderation_settings$$,
  $$values (0.65::real, 0.85::real, 3::smallint, 5::smallint)$$,
  'the prompt''s thresholds and three strikes are the defaults');
select is((select no_strike_categories from private.moderation_settings),
  array['self-harm', 'self-harm/intent', 'self-harm/instructions'],
  'self-harm categories remove without a strike');
select throws_ok('update private.moderation_settings set toxicity_hide_at = 0.9',
  '23514', null, 'the hide line cannot sit above the removal line');
select throws_ok('insert into private.moderation_settings default values',
  '23505', null, 'there is one settings row');

-- ---------------------------------------------------------------------------
-- The decision.
-- ---------------------------------------------------------------------------
create function pg_temp.verdict(p_flagged text[], p_toxicity real) returns text
language sql as $$
  select v.state || case when v.strike then '+strike' else '' end
    from private.moderation_verdict(
      jsonb_build_object('flagged', to_jsonb(p_flagged), 'toxicity', p_toxicity)) v;
$$;

select is(pg_temp.verdict('{}', 0.1), 'ok', 'nothing flagged, low toxicity: ok');
select is(pg_temp.verdict('{}', 0.649), 'ok', 'just under the hide line: ok');
select is(pg_temp.verdict('{}', 0.65), 'hidden', 'at the hide line: hidden');
select is(pg_temp.verdict('{}', 0.85), 'hidden', 'at the removal line: still hidden');
select is(pg_temp.verdict('{}', 0.851), 'removed+strike', 'above the removal line: removed, a strike');
select is(pg_temp.verdict('{harassment}', 0.1), 'removed+strike',
  'any OpenAI flag: removed, a strike');
select is(pg_temp.verdict('{hate/threatening,violence}', 0), 'removed+strike',
  'several flags: removed, one strike');
select is(pg_temp.verdict('{self-harm/intent}', 0.1), 'removed',
  'self-harm alone: removed, no strike');
select is(pg_temp.verdict('{self-harm,harassment}', 0.1), 'removed+strike',
  'self-harm with harassment: a strike');
select is(pg_temp.verdict('{self-harm}', 0.9), 'removed+strike',
  'self-harm above the removal line: a strike');
select throws_ok($$select private.moderation_verdict('{"flagged": []}')$$, '22023', null,
  'signals without a toxicity are refused');
select throws_ok($$select private.moderation_verdict('{"flagged": [], "toxicity": 1.5}')$$,
  '22023', null, 'a toxicity outside 0 to 1 is refused');

update private.moderation_settings set toxicity_hide_at = 0.5;
select is(pg_temp.verdict('{}', 0.6), 'hidden', 'tuning the hide line changes the outcome');
update private.moderation_settings set toxicity_hide_at = 0.65;

-- ---------------------------------------------------------------------------
-- Recording the answer: service role only.
-- ---------------------------------------------------------------------------
create function pg_temp.scores(p_flagged text[], p_toxicity real) returns jsonb
language sql as $$
  select jsonb_build_object(
    'openai', jsonb_build_object('flagged', cardinality(p_flagged) > 0),
    'google', jsonb_build_object('moderationCategories',
                jsonb_build_array(jsonb_build_object('name', 'Toxic', 'confidence', p_toxicity))),
    'signals', jsonb_build_object('flagged', to_jsonb(p_flagged), 'toxicity', p_toxicity));
$$;
grant execute on function pg_temp.scores(text[], real) to service_role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000004a1", "role": "authenticated"}', true);
select throws_ok(
  $$select public.record_moderation('00000000-0000-4000-8000-0000000004c1', '{}')$$,
  '42501', null, 'an author cannot approve their own post');
reset role;
set local role anon;
select throws_ok(
  $$select public.record_moderation('00000000-0000-4000-8000-0000000004c1', '{}')$$,
  '42501', null, 'nor can a guest');
reset role;

set local role service_role;
select is(public.record_moderation('00000000-0000-4000-8000-0000000004c1', pg_temp.scores('{}', 0.1)),
  'ok', 'a clean post is approved');
select is(public.record_moderation('00000000-0000-4000-8000-0000000004c1',
                                   pg_temp.scores('{harassment}', 0.99)),
  'ok', 'a second answer changes nothing: the first decision stands');
select is(public.record_moderation('00000000-0000-4000-8000-0000000004c2', pg_temp.scores('{}', 0.7)),
  'hidden', 'a borderline post is hidden');
select is(public.record_moderation('00000000-0000-4000-8000-0000000004c3',
                                   pg_temp.scores('{harassment}', 0.2)),
  'removed', 'a flagged post is removed');
select is(public.record_moderation('00000000-0000-4000-8000-0000000004c4',
                                   pg_temp.scores('{self-harm/intent}', 0.1)),
  'removed', 'a self-harm post is removed');
select is(public.record_moderation('00000000-0000-4000-8000-0000000000ff', pg_temp.scores('{}', 0)),
  'gone', 'an answer for a deleted post is dropped');
select throws_ok(
  $$select public.record_moderation('00000000-0000-4000-8000-0000000004c5', '{"signals": {}}')$$,
  '22023', null, 'scores without signals are refused, and the post stays pending');
reset role;

select results_eq(
  $$select mod_state from public.posts
     where id::text like '00000000-0000-4000-8000-0000000004c_' order by id$$,
  $$values ('ok'::text), ('hidden'), ('removed'), ('removed'), ('pending'), ('pending'),
           ('pending'), ('pending'), ('pending')$$,
  'each post holds its decision');
select ok((select mod_scores ?& array['openai', 'google', 'signals', 'checked_at']
             and moderated_at is not null
             from public.posts where id = '00000000-0000-4000-8000-0000000004c1'),
  'the full score object is stored, with when it was checked');
select is((select post_count from public.discussions
            where story_id = '00000000-0000-4000-8000-0000000004b1'),
  1, 'only the approved post counts');

select results_eq(
  $$select post_id, source from public.strikes
     where user_id = '00000000-0000-4000-8000-0000000004a1'$$,
  $$values ('00000000-0000-4000-8000-0000000004c3'::uuid, 'auto'::text)$$,
  'the flagged post gave one automatic strike; the self-harm post none');
select is((select strikes from public.profiles where id = '00000000-0000-4000-8000-0000000004a1'),
  1::smallint, 'the profile counts it');
select results_eq(
  $$select post_id, detail ->> 'strike', detail ->> 'strikes', detail ->> 'suspended',
           detail -> 'flagged'
      from public.notifications
     where user_id = '00000000-0000-4000-8000-0000000004a1' order by post_id$$,
  $$values ('00000000-0000-4000-8000-0000000004c3'::uuid, 'true', '1', 'false',
            '["harassment"]'::jsonb),
           ('00000000-0000-4000-8000-0000000004c4'::uuid, 'false', '1', 'false',
            '["self-harm/intent"]'::jsonb)$$,
  'the author is told about each removal, its strike and where they stand');

-- One strike per post, however it is removed.
select throws_ok($$insert into public.strikes (user_id, post_id, source)
                   values ('00000000-0000-4000-8000-0000000004a1',
                           '00000000-0000-4000-8000-0000000004c3', 'moderator')$$,
  '23505', null, 'a post never gives a second strike');
select is((select strikes from public.profiles where id = '00000000-0000-4000-8000-0000000004a1'),
  1::smallint, 'and the count stays');

-- ---------------------------------------------------------------------------
-- Three strikes suspend.
-- ---------------------------------------------------------------------------
set local role service_role;
select public.record_moderation('00000000-0000-4000-8000-0000000004c5', pg_temp.scores('{}', 0.95));
reset role;
select is((select suspended_at from public.profiles where id = '00000000-0000-4000-8000-0000000004a1'),
  null, 'two strikes: not suspended');
set local role service_role;
select public.record_moderation('00000000-0000-4000-8000-0000000004c6', pg_temp.scores('{hate}', 0.3));
reset role;
select isnt((select suspended_at from public.profiles where id = '00000000-0000-4000-8000-0000000004a1'),
  null, 'the third strike suspends');
select is((select detail ->> 'suspended' from public.notifications
            where post_id = '00000000-0000-4000-8000-0000000004c6'),
  'true', 'and the notice says so');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000004a1", "role": "authenticated"}', true);
select is(private.can_take_part(), false, 'a suspended account cannot take part');
select throws_ok($$insert into public.posts (story_id, body, kind)
                   values ('00000000-0000-4000-8000-0000000004b1', 'still here', 'argument')$$,
  '42501', null, 'a suspended account cannot post');
select throws_ok($$insert into public.discussion_stances (story_id, stance)
                   values ('00000000-0000-4000-8000-0000000004b2', 'a')$$,
  '42501', null, 'or take a side in another debate');
reset role;
-- Reader B wrote an approved post; the suspended author cannot vote on it.
insert into public.posts (id, story_id, author_id, body, stance, kind, mod_state) values
  ('00000000-0000-4000-8000-0000000004d1', '00000000-0000-4000-8000-0000000004b1',
   '00000000-0000-4000-8000-0000000004a2', 'from b', 'b', 'argument', 'ok');
set local role authenticated;
select throws_ok($$insert into public.votes (post_id, kind)
                   values ('00000000-0000-4000-8000-0000000004d1', 'helpful')$$,
  '42501', null, 'or vote');
select is((select count(*) from public.posts where author_id = auth.uid()), 9::bigint,
  'but still reads their own posts');

-- ---------------------------------------------------------------------------
-- Notifications: their owner reads them and marks them read; nothing else.
-- ---------------------------------------------------------------------------
select is((select count(*) from public.notifications), 4::bigint, 'the author reads their notices');
select is((select count(*) from public.notifications where read_at is null), 4::bigint,
  'all unread');
update public.notifications set read_at = now() where read_at is null;
select is((select count(*) from public.notifications where read_at is null), 0::bigint,
  'and marks them read');
select throws_ok($$update public.notifications set detail = '{}'$$, '42501', null,
  'but cannot rewrite them');
select throws_ok($$insert into public.notifications (user_id, kind)
                   values (auth.uid(), 'post_removed')$$,
  '42501', null, 'or write their own');
select throws_ok('select * from public.strikes', '42501', null,
  'strike rows are not theirs to read');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000004a2", "role": "authenticated"}', true);
select is((select count(*) from public.notifications), 0::bigint,
  'another reader sees none of them');
update public.notifications set read_at = null;
reset role;
select is((select count(*) from public.notifications where read_at is null), 0::bigint,
  'nor can mark them unread');
set local role anon;
select throws_ok('select * from public.notifications', '42501', null, 'guests read no notices');
reset role;
select is((select count(*) from private.moderation_settings), 1::bigint, 'settings exist');
set local role authenticated;
select throws_ok('select * from private.moderation_settings', '42501', null,
  'clients cannot read the thresholds');
reset role;

-- ---------------------------------------------------------------------------
-- The hand-off: a new post is queued for the function, with the secret.
-- ---------------------------------------------------------------------------
select vault.create_secret('http://moderation.test.invalid/moderate-post', 'moderation_function_url');
select vault.create_secret('test-hook-secret', 'moderation_hook_secret');
update public.profiles set suspended_at = null where id = '00000000-0000-4000-8000-0000000004a1';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-0000000004a2", "role": "authenticated"}', true);
insert into public.posts (story_id, body, kind) values
  ('00000000-0000-4000-8000-0000000004b1', 'hand me to the models', 'argument');
reset role;

select results_eq(
  $$select method::text, headers ->> 'x-moderation-secret', convert_from(body, 'utf8')::jsonb ->> 'body'
      from net.http_request_queue where url = 'http://moderation.test.invalid/moderate-post'$$,
  $$values ('POST'::text, 'test-hook-secret'::text, 'hand me to the models'::text)$$,
  'a new post is sent to the function with the hook secret');
select is((select convert_from(body, 'utf8')::jsonb ->> 'post_id' from net.http_request_queue
            where url = 'http://moderation.test.invalid/moderate-post'),
  (select id::text from public.posts where body = 'hand me to the models'),
  'naming the post');
select results_eq(
  $$select mod_state, mod_attempts from public.posts where body = 'hand me to the models'$$,
  $$values ('pending'::text, 1::smallint)$$,
  'it waits, pending, with one attempt counted');
select is((select count(*) from net.http_request_queue
            where convert_from(body, 'utf8')::jsonb ->> 'post_id' like '00000000-0000-4000-8000-0000000004c_'),
  0::bigint, 'the posts inserted before the Vault entries were not sent');

-- ---------------------------------------------------------------------------
-- The sweep: pending posts are asked about again, up to max_attempts.
-- ---------------------------------------------------------------------------
update public.posts set mod_requested_at = now() - interval '10 minutes', mod_attempts = 1
 where id = '00000000-0000-4000-8000-0000000004c7';
update public.posts set mod_requested_at = now() - interval '10 minutes', mod_attempts = 5
 where id = '00000000-0000-4000-8000-0000000004c8';
update public.posts set mod_requested_at = now(), mod_attempts = 1
 where id = '00000000-0000-4000-8000-0000000004c9';
update public.posts set created_at = now() - interval '10 minutes'
 where id::text like '00000000-0000-4000-8000-0000000004c_';

select ok(private.retry_moderation() >= 1, 'the sweep resends what is due');
select is((select mod_attempts from public.posts where id = '00000000-0000-4000-8000-0000000004c7'),
  2::smallint, 'counting the attempt');
select is((select count(*) from net.http_request_queue
            where convert_from(body, 'utf8')::jsonb ->> 'post_id' in ('00000000-0000-4000-8000-0000000004c8',
                                                 '00000000-0000-4000-8000-0000000004c9')),
  0::bigint, 'not one out of attempts, nor one just asked');

select results_eq(
  $$select jobname::text, schedule::text from cron.job where jobname = 'retry-moderation'$$,
  $$values ('retry-moderation'::text, '* * * * *'::text)$$,
  'the sweep runs every minute');

set local role authenticated;
select throws_ok('select private.retry_moderation()', '42501', null,
  'a client cannot run the sweep');
reset role;

select * from finish();
rollback;
