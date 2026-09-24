-- Ingest bookkeeping (Prompt 2.2): per-story grouping state, the run ledger,
-- and the functions the ingest Worker calls with the service key.
--
-- Nothing here is readable or callable by a client role. The Worker computes
-- everything (grouping, heat, categories) in TypeScript, where it is unit
-- tested; these functions only read candidates and write a batch atomically.

-- ---------------------------------------------------------------------------
-- Close a gap in the first migration's deny-by-default. New functions get
-- EXECUTE for PUBLIC from a *global* default, and Postgres only ever adds
-- per-schema defaults to global ones, so that migration's per-schema revoke
-- from PUBLIC was a no-op. It never mattered because no function existed yet;
-- these are the first. The global revoke covers every function the migration
-- role creates from now on, and each function below is also revoked by name.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- story_signals: what the Worker needs to keep grouping articles into a story
-- across runs, kept beside `stories` so public reads never carry it.
-- ---------------------------------------------------------------------------
create table public.story_signals (
  story_id     uuid primary key references public.stories (id) on delete cascade,
  -- The story's distinctive event keys ("p:t kelly", "o:cnn", "l:531871").
  keys         text[] not null default '{}' check (cardinality(keys) <= 64),
  -- Versioned evidence the Worker re-derives title, place, category and heat
  -- from (workers/ingest/src/pipeline/signals.ts). Capped so a runaway story
  -- cannot grow a row without bound.
  state        jsonb not null
                 check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 65536),
  last_seen_at timestamptz not null
);

-- No GIN index on keys: ingest_candidates hash-joins the keys instead, which
-- measured 32 ms against 4.3 s for GIN probes on 3,600 stories, and a GIN
-- index would be half this table's storage.
create index story_signals_last_seen_idx on public.story_signals (last_seen_at desc);

-- ---------------------------------------------------------------------------
-- ingest_runs: one row per GDELT 15-minute slot. It is the cursor (the last
-- slot done), the lock (a running claim), and the audit log.
-- ---------------------------------------------------------------------------
create table public.ingest_runs (
  slot        timestamptz primary key,
  status      text not null check (status in ('running', 'done', 'failed', 'skipped')),
  attempts    smallint not null default 1 check (attempts >= 1),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  counts      jsonb check (counts is null or jsonb_typeof(counts) = 'object'),
  error       text check (char_length(error) <= 2000)
);

-- ---------------------------------------------------------------------------
-- Access: service role only. No grants to client roles, and a restrictive
-- policy so a grant added by mistake still reads nothing (as for `reports`).
-- ---------------------------------------------------------------------------
alter table public.story_signals enable row level security;
alter table public.ingest_runs enable row level security;

create policy "story_signals: service role only"
  on public.story_signals as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "ingest_runs: service role only"
  on public.ingest_runs as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- Functions. All run as the caller (service_role bypasses RLS), pin an empty
-- search_path, and are executable by service_role alone (grants at the end).
-- ---------------------------------------------------------------------------

-- Take a slot. Succeeds for a new slot, a failed one, or a claim that has been
-- "running" long enough to be a crashed run; refuses a slot that is done,
-- skipped, or genuinely in progress. This is what stops the cron and the
-- manual route ingesting the same slot twice.
create function public.ingest_claim(p_slot timestamptz, p_stale interval default '10 minutes')
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.ingest_runs as r (slot, status, started_at)
  values (p_slot, 'running', now())
  on conflict (slot) do update
    set status = 'running', attempts = r.attempts + 1, started_at = now(),
        finished_at = null, error = null
    where r.status = 'failed'
       or (r.status = 'running' and r.started_at < now() - p_stale);
  return found;
end;
$$;

-- Close a slot without writing news: failed (retried later, up to three
-- attempts, then skipped so one bad file cannot stall the cursor) or skipped.
create function public.ingest_finish(
  p_slot timestamptz, p_status text, p_counts jsonb default null, p_error text default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_status not in ('failed', 'skipped') then
    raise exception 'ingest_finish: status must be failed or skipped, got %', p_status;
  end if;

  insert into public.ingest_runs as r (slot, status, finished_at, counts, error)
  values (p_slot, p_status, now(), p_counts, left(p_error, 2000))
  on conflict (slot) do update
    set status = case when excluded.status = 'failed' and r.attempts >= 3 then 'skipped'
                      else excluded.status end,
        finished_at = now(), counts = excluded.counts, error = excluded.error
  returning status into v_status;

  return v_status;
end;
$$;

-- Which of these URLs are already stored, so a re-listed article is neither
-- re-inserted nor counted twice toward a story's heat.
create function public.ingest_known_urls(p_urls text[])
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  select a.url from public.articles a where a.url = any (p_urls);
$$;

-- For each batch cluster ({"i": n, "keys": [...]}), the up to three recent
-- stories sharing the most keys with it (at least p_min_overlap). The Worker
-- applies the real merge rule; this narrows thousands of stories to a few.
--
-- Set-based: every cluster key is hash-joined to every stored key in the
-- window, then counted per (cluster, story). Each posting is read once, where
-- a per-cluster index probe would read the popular ones hundreds of times.
create function public.ingest_candidates(
  p_clusters jsonb, p_since timestamptz, p_min_overlap integer default 2
)
returns table (
  cluster          integer,
  story_id         uuid,
  overlap          integer,
  keys             text[],
  state            jsonb,
  discussion_state text,
  heat             smallint,
  published_at     timestamptz,
  first_seen_at    timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with wanted as (
    select c.i, k.key
    from jsonb_to_recordset(p_clusters) as c (i integer, keys text[])
    cross join lateral unnest(c.keys) as k (key)
  ),
  stored as (
    select g.story_id, g.last_seen_at, k.key
    from public.story_signals g
    cross join lateral unnest(g.keys) as k (key)
    where g.last_seen_at >= p_since
  ),
  hits as (
    select w.i, s.story_id, count(*)::integer as overlap, max(s.last_seen_at) as seen
    from wanted w
    join stored s on s.key = w.key
    group by w.i, s.story_id
    having count(*) >= p_min_overlap
  ),
  ranked as (
    select h.*, row_number() over (
      partition by h.i order by h.overlap desc, h.seen desc, h.story_id
    ) as rank
    from hits h
  )
  select r.i, r.story_id, r.overlap, g.keys, g.state,
         s.discussion_state, s.heat, s.published_at, s.first_seen_at
  from ranked r
  join public.story_signals g on g.story_id = r.story_id
  join public.stories s on s.id = r.story_id
  where r.rank <= 3;
$$;

-- Write one slot's stories, signals and articles, and mark the slot done, in
-- one transaction: a failure anywhere leaves nothing half-written, and the
-- retry starts clean. Replaying the same batch changes nothing.
--
-- Guards repeat the Worker's rules so a bug there cannot break them: a story
-- past `none` keeps its title, place and category; heat only rises; the state
-- only moves none -> queued here (open and closed belong to the admin).
create function public.ingest_apply(p_batch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slot     timestamptz := (p_batch ->> 'slot')::timestamptz;
  v_new      integer;
  v_updated  integer;
  v_articles integer;
begin
  if v_slot is null then
    raise exception 'ingest_apply: batch has no slot';
  end if;

  with upserted as (
    insert into public.stories as s (
      id, title, category, lat, lon, place_name, place_source, place_conf, country_code,
      heat, sentiment, source_count, published_at, first_seen_at, title_hash, discussion_state
    )
    select x.id, x.title, x.category, x.lat, x.lon, x.place_name, 'gdelt', x.place_conf,
           x.country_code, x.heat, x.sentiment, x.source_count, x.published_at,
           x.first_seen_at, x.title_hash, x.discussion_state
    from jsonb_to_recordset(p_batch -> 'stories') as x (
      id uuid, title text, category smallint, lat double precision, lon double precision,
      place_name text, place_conf smallint, country_code text, heat smallint,
      sentiment smallint, source_count smallint, published_at timestamptz,
      first_seen_at timestamptz, title_hash bigint, discussion_state text
    )
    on conflict (id) do update set
      title        = case when s.discussion_state = 'none' then excluded.title else s.title end,
      title_hash   = case when s.discussion_state = 'none' then excluded.title_hash else s.title_hash end,
      category     = case when s.discussion_state = 'none' then excluded.category else s.category end,
      lat          = case when s.discussion_state = 'none' then excluded.lat else s.lat end,
      lon          = case when s.discussion_state = 'none' then excluded.lon else s.lon end,
      place_name   = case when s.discussion_state = 'none' then excluded.place_name else s.place_name end,
      place_conf   = case when s.discussion_state = 'none' then excluded.place_conf else s.place_conf end,
      country_code = case when s.discussion_state = 'none' then excluded.country_code else s.country_code end,
      heat         = greatest(s.heat, excluded.heat),
      sentiment    = excluded.sentiment,
      source_count = greatest(s.source_count, excluded.source_count),
      published_at = least(s.published_at, excluded.published_at),
      discussion_state = case
        when s.discussion_state = 'none' and excluded.discussion_state = 'queued' then 'queued'
        else s.discussion_state end
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_new, v_updated
    from upserted;

  insert into public.story_signals as g (story_id, keys, state, last_seen_at)
  select x.story_id, x.keys, x.state, x.last_seen_at
  from jsonb_to_recordset(p_batch -> 'signals') as x (
    story_id uuid, keys text[], state jsonb, last_seen_at timestamptz
  )
  on conflict (story_id) do update set
    keys = excluded.keys,
    state = excluded.state,
    last_seen_at = greatest(g.last_seen_at, excluded.last_seen_at);

  insert into public.articles (
    story_id, url, outlet, outlet_country, headline, image_url, published_at, lang
  )
  select x.story_id, x.url, x.outlet, x.outlet_country, x.headline, x.image_url,
         x.published_at, x.lang
  from jsonb_to_recordset(p_batch -> 'articles') as x (
    story_id uuid, url text, outlet text, outlet_country text, headline text,
    image_url text, published_at timestamptz, lang text
  )
  on conflict (url) do nothing;
  get diagnostics v_articles = row_count;

  insert into public.ingest_runs as r (slot, status, finished_at, counts)
  values (v_slot, 'done', now(), p_batch -> 'counts')
  on conflict (slot) do update
    set status = 'done', finished_at = now(), counts = excluded.counts, error = null;

  return jsonb_build_object(
    'stories_new', v_new, 'stories_updated', v_updated, 'articles_new', v_articles
  );
end;
$$;

-- Retention: stories first published before the cutoff go, with their articles
-- and signals (cascade). A story with a discussion stays: that foreign key is
-- RESTRICT on purpose (2.1), because deleting it would take a live debate and
-- everyone's posts with it. Old run-ledger rows go too.
--
-- Signals go sooner, once a story has had no coverage for the match window:
-- only ingest_candidates reads them, and it never looks further back. They
-- are most of the ingest's storage (about 1.5 KB a story), so keeping them for
-- the full story retention would double it.
create function public.ingest_prune(
  p_story_cutoff timestamptz, p_run_cutoff timestamptz, p_signal_cutoff timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
  v_kept    integer;
  v_runs    integer;
  v_signals integer := 0;
begin
  delete from public.stories s
   where s.published_at < p_story_cutoff
     and not exists (select 1 from public.discussions d where d.story_id = s.id);
  get diagnostics v_deleted = row_count;

  select count(*) into v_kept from public.stories s where s.published_at < p_story_cutoff;

  delete from public.ingest_runs r where r.slot < p_run_cutoff;
  get diagnostics v_runs = row_count;

  if p_signal_cutoff is not null then
    delete from public.story_signals g where g.last_seen_at < p_signal_cutoff;
    get diagnostics v_signals = row_count;
  end if;

  return jsonb_build_object(
    'stories_deleted', v_deleted, 'stories_kept_for_discussion', v_kept,
    'runs_deleted', v_runs, 'signals_deleted', v_signals
  );
end;
$$;

revoke all on function
  public.ingest_claim(timestamptz, interval),
  public.ingest_finish(timestamptz, text, jsonb, text),
  public.ingest_known_urls(text[]),
  public.ingest_candidates(jsonb, timestamptz, integer),
  public.ingest_apply(jsonb),
  public.ingest_prune(timestamptz, timestamptz, timestamptz)
from public, anon, authenticated;

grant execute on function
  public.ingest_claim(timestamptz, interval),
  public.ingest_finish(timestamptz, text, jsonb, text),
  public.ingest_known_urls(text[]),
  public.ingest_candidates(jsonb, timestamptz, integer),
  public.ingest_apply(jsonb),
  public.ingest_prune(timestamptz, timestamptz, timestamptz)
to service_role;
