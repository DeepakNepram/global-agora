-- Structure: RLS everywhere, the exact grant matrix, PostGIS and the GIST index.
-- Run with `npm run db:test`. Each file runs in a transaction that rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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
  array['articles', 'blocks', 'discussions', 'feature_flags', 'posts',
        'profiles', 'reports', 'stories', 'votes'],
  'public holds exactly the v1 tables'
);

-- The grant matrix (docs/DATA_SCHEMA.md). Grants are the first lock, RLS the second.
select table_privs_are('public', 'stories',       'anon', array['SELECT'], 'anon: read stories');
select table_privs_are('public', 'articles',      'anon', array['SELECT'], 'anon: read articles');
select table_privs_are('public', 'discussions',   'anon', '{}'::text[],   'anon: nothing on discussions');
select table_privs_are('public', 'posts',         'anon', '{}'::text[],   'anon: nothing on posts');
select table_privs_are('public', 'votes',         'anon', '{}'::text[],   'anon: nothing on votes');
select table_privs_are('public', 'reports',       'anon', '{}'::text[],   'anon: nothing on reports');
select table_privs_are('public', 'blocks',        'anon', '{}'::text[],   'anon: nothing on blocks');
select table_privs_are('public', 'profiles',      'anon', '{}'::text[],   'anon: nothing on profiles');
select table_privs_are('public', 'feature_flags', 'anon', '{}'::text[],   'anon: nothing on feature_flags');

select table_privs_are('public', 'stories',       'authenticated', array['SELECT'], 'signed in: read stories');
select table_privs_are('public', 'articles',      'authenticated', array['SELECT'], 'signed in: read articles');
select table_privs_are('public', 'discussions',   'authenticated', array['SELECT'], 'signed in: read discussions');
select table_privs_are('public', 'posts',         'authenticated', array['SELECT'], 'signed in: read posts (RLS filters)');
select table_privs_are('public', 'votes',         'authenticated', array['SELECT'], 'signed in: read votes (RLS: own)');
select table_privs_are('public', 'reports',       'authenticated', '{}'::text[],   'signed in: nothing on reports');
select table_privs_are('public', 'blocks',        'authenticated', array['SELECT'], 'signed in: read blocks (RLS: own)');
select table_privs_are('public', 'profiles',      'authenticated', array['SELECT'], 'signed in: read profiles (RLS: own)');
select table_privs_are('public', 'feature_flags', 'authenticated', array['SELECT'], 'signed in: read feature_flags');

-- Generic guards that survive new tables and functions.
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
      and privilege_type <> 'SELECT'),
  0::bigint,
  'no client role holds a write privilege on any public table'
);

select is(
  (select coalesce(array_agg(p.proname::text), '{}')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))),
  '{}'::text[],
  'no public function is callable by a client role unless granted on purpose'
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

select * from finish();
rollback;
