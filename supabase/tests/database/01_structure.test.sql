-- Structure: RLS everywhere, the exact grant matrix, PostGIS and the GIST index.
-- Run with `npm run db:test`. Each file runs in a transaction that rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

-- CLAUDE.md #8, checked generically so a table added later is covered too.
select is(
  (select coalesce(array_agg(c.relname::text order by c.relname), '{}')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  '{}'::text[],
  'every table in public has row-level security enabled'
);

select is(
  (select coalesce(array_agg(c.relname::text order by c.relname), '{}')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.tablename = c.relname)),
  '{}'::text[],
  'every table in public has at least one explicit policy'
);

-- A new table fails here until someone decides its row in the matrix below.
select tables_are(
  'public',
  array['articles', 'blocks', 'discussion_stances', 'discussions', 'feature_flags', 'follows',
        'ingest_runs', 'notifications', 'posts', 'profiles', 'reports', 'saved_stories', 'stories',
        'story_location_reports', 'story_signals', 'strikes', 'votes'],
  'public holds exactly the v1 tables, the ingest ledger, the location reports, the library, '
  'stances, strikes and notifications'
);

-- The private schema's tables (settings) are for definer functions only.
select is(
  (select coalesce(array_agg(c.relname::text order by c.relname), '{}')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  '{}'::text[],
  'every table in private has row-level security enabled'
);
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'private' and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint,
  'no API role holds any privilege on a private table'
);

-- The grant matrix (docs/DATA_SCHEMA.md). Grants are the first lock, RLS the second.
select table_privs_are('public', 'stories',       'anon', array['SELECT'], 'anon: read stories');
select table_privs_are('public', 'articles',      'anon', array['SELECT'], 'anon: read articles');
select table_privs_are('public', 'discussions',   'anon', array['SELECT'], 'anon: read discussions (Prompt 4.2)');
select table_privs_are('public', 'posts',         'anon', '{}'::text[],   'anon: no table-wide grant on posts (read by column)');
select table_privs_are('public', 'votes',         'anon', '{}'::text[],   'anon: nothing on votes');
select table_privs_are('public', 'reports',       'anon', '{}'::text[],   'anon: nothing on reports');
select table_privs_are('public', 'blocks',        'anon', '{}'::text[],   'anon: nothing on blocks');
select table_privs_are('public', 'profiles',      'anon', '{}'::text[],   'anon: no table-wide grant on profiles');
select table_privs_are('public', 'feature_flags', 'anon', '{}'::text[],   'anon: nothing on feature_flags');
select table_privs_are('public', 'story_signals', 'anon', '{}'::text[],   'anon: nothing on story_signals');
select table_privs_are('public', 'ingest_runs',   'anon', '{}'::text[],   'anon: nothing on ingest_runs');
select table_privs_are('public', 'story_location_reports', 'anon', '{}'::text[],
  'anon: nothing on story_location_reports');
select table_privs_are('public', 'follows',       'anon', '{}'::text[],   'anon: nothing on follows');
select table_privs_are('public', 'saved_stories', 'anon', '{}'::text[],   'anon: nothing on saved_stories');
select table_privs_are('public', 'strikes',       'anon', '{}'::text[],   'anon: nothing on strikes');
select table_privs_are('public', 'notifications', 'anon', '{}'::text[],   'anon: nothing on notifications');

select table_privs_are('public', 'stories',       'authenticated', array['SELECT'], 'signed in: read stories');
select table_privs_are('public', 'articles',      'authenticated', array['SELECT'], 'signed in: read articles');
select table_privs_are('public', 'discussions',   'authenticated', array['SELECT'], 'signed in: read discussions');
select table_privs_are('public', 'posts',         'authenticated', '{}'::text[],   'signed in: posts by column only');
select table_privs_are('public', 'discussion_stances', 'anon', '{}'::text[], 'anon: nothing on stances');
select table_privs_are('public', 'discussion_stances', 'authenticated', array['SELECT'],
  'signed in: read your stance (RLS: own); writes by column');
select table_privs_are('public', 'votes',         'authenticated', array['SELECT'], 'signed in: read votes (RLS: own)');
select table_privs_are('public', 'reports',       'authenticated', '{}'::text[],   'signed in: nothing on reports');
select table_privs_are('public', 'blocks',        'authenticated', array['DELETE', 'SELECT'],
  'signed in: read and remove blocks (RLS: own); add by column (Prompt 4.3)');
select table_privs_are('public', 'profiles',      'authenticated', '{}'::text[],   'signed in: no table-wide grant on profiles');
-- Profiles are read by column (Prompt 4.1): the public fields, never the private ones.
select column_privs_are('public', 'profiles', 'handle', 'anon', array['SELECT'],
  'anyone reads a profile''s handle');
select column_privs_are('public', 'profiles', 'strikes', 'authenticated', '{}'::text[],
  'nobody reads strikes from the table');
select table_privs_are('public', 'feature_flags', 'authenticated', array['SELECT'], 'signed in: read feature_flags');
select table_privs_are('public', 'strikes',       'authenticated', '{}'::text[],
  'signed in: nothing on strikes (the count comes through my_profile)');
select table_privs_are('public', 'notifications', 'authenticated', array['SELECT'],
  'signed in: read notifications (RLS: own); mark read by column');
select table_privs_are('public', 'story_signals', 'authenticated', '{}'::text[],   'signed in: nothing on story_signals');
select table_privs_are('public', 'ingest_runs',   'authenticated', '{}'::text[],   'signed in: nothing on ingest_runs');
select table_privs_are('public', 'story_location_reports', 'authenticated', '{}'::text[],
  'signed in: nothing on story_location_reports');
-- The library (Prompt 3.4): the only tables a client writes, and only its own rows (RLS).
select table_privs_are('public', 'follows', 'authenticated', array['SELECT', 'INSERT', 'DELETE'],
  'signed in: read, add and remove follows (RLS: own)');
select table_privs_are('public', 'saved_stories', 'authenticated', array['SELECT', 'INSERT', 'DELETE'],
  'signed in: read, add and remove saved stories (RLS: own)');

-- Generic guards that survive new tables and functions.
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
      and privilege_type <> 'SELECT'
      and not (grantee = 'authenticated'
               and table_name in ('follows', 'saved_stories')
               and privilege_type in ('INSERT', 'DELETE'))
      and not (grantee = 'authenticated' and table_name = 'blocks' and privilege_type = 'DELETE')),
  0::bigint,
  'no client role holds a table-wide write privilege but on its own library and blocks'
);

-- Column-level writes (Prompt 4.2), exactly these: what a post, a vote and a
-- stance may say, and marking your notices read (4.3). Never moderation
-- state, counts, rank or the region label.
select is(
  (select array_agg(format('%s.%s:%s', table_name, column_name, privilege_type)
                    order by table_name, column_name, privilege_type)
     from information_schema.column_privileges
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
      and privilege_type <> 'SELECT'
      and table_name not in ('follows', 'saved_stories')),
  array['blocks.blocked_id:INSERT',
        'discussion_stances.stance:INSERT', 'discussion_stances.stance:UPDATE',
        'discussion_stances.story_id:INSERT',
        'notifications.read_at:UPDATE',
        'posts.body:INSERT', 'posts.evidence_url:INSERT', 'posts.kind:INSERT',
        'posts.stance:INSERT', 'posts.story_id:INSERT',
        'votes.kind:INSERT', 'votes.post_id:INSERT'],
  'clients write exactly these columns outside their library'
);

-- The policy helpers in private are not API endpoints (PostgREST exposes
-- public only); client roles may call exactly these from policies.
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))),
  array['blocked_either_way', 'can_take_part', 'post_rank'],
  'client roles can call exactly the policy helpers in private, and the rank a post insert computes'
);

-- Exactly the API's functions: the two reads (Prompt 2.3), the participant
-- count api_story calls and the location report (Prompt 3.3), and outlet
-- search with the window it shares with the payload (Prompt 3.4), and the
-- first sign-in's flow and account deletion (Prompt 4.1), and reporting a
-- post (4.3). Anything else a client could call is a mistake.
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))),
  array['accept_rules', 'api_nodes', 'api_outlet_stories', 'api_outlets', 'api_report_location',
        'api_story', 'api_window', 'claim_handle', 'delete_my_account', 'discussion_participants',
        'handles_available', 'my_profile', 'report_post'],
  'client roles can call exactly the API functions'
);

-- The moderation function answers with the service role (Prompt 4.3).
select ok(
  has_function_privilege('service_role', 'public.record_moderation(uuid, jsonb)', 'execute'),
  'the service role records moderation answers'
);

-- The ingest Worker writes with the service role, so it must keep its grants.
select ok(
  has_table_privilege('service_role', 'public.stories', 'insert, update, delete'),
  'service role can still write stories'
);

-- PostGIS lives in `extensions`, so its functions never become API endpoints.
select ok(
  exists (select 1 from pg_extension e
            join pg_namespace n on n.oid = e.extnamespace
           where e.extname = 'postgis' and n.nspname = 'extensions'),
  'PostGIS is installed in the extensions schema'
);

select has_index('public', 'stories', 'stories_geog_gist', 'stories has a geography index');
select index_is_type('public', 'stories', 'stories_geog_gist', 'gist', 'the geography index is GIST');

-- Ingest reads signals by recency, and prunes them by it.
select has_index('public', 'story_signals', 'story_signals_last_seen_idx',
  'story_signals are indexed by when they were last seen');

select * from finish();
rollback;
