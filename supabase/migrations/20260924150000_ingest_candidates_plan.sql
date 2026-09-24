-- Fix ingest_candidates' plan (Prompt 2.3 found it; 2.2 introduced it).
--
-- Inside the function the planner flattened the batch's keys (`wanted`) into
-- the per-story lateral unnest, so it could read story_signals in key order,
-- and then re-evaluated the batch's jsonb once for every stored story. With
-- 3,600 stories (2.2's test) that never showed. At 14,000 (six hours of real
-- news) one call took 6.8 to 12.6 s, and a full day's 34,000 would have hit
-- statement timeouts on every ingest run.
--
-- MATERIALIZED makes each key set a CTE evaluated once, and they are then
-- hash-joined: 128 to 179 ms for the same calls, with identical results.
-- (EXECUTE with a custom plan and enable_nestloop = off were both tried and
-- stayed slow: the lateral unnest needs a nested loop either way.)
-- Same signature, result and grants: create or replace keeps the ACL.
create or replace function public.ingest_candidates(
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
  with wanted as materialized (
    select c.i, k.key
    from jsonb_to_recordset(p_clusters) as c (i integer, keys text[])
    cross join lateral unnest(c.keys) as k (key)
  ),
  stored as materialized (
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
