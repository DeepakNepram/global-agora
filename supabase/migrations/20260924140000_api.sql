-- Reads for the API Worker (Prompt 2.3): the globe's columnar payload and one
-- story in full. Both run as the caller (security invoker), so RLS decides what
-- they see; the Worker calls them with the publishable key, never the service
-- key, because everything here is public news.

-- ---------------------------------------------------------------------------
-- A short id per story for the payload. UUIDs are 16 random bytes each, and
-- random bytes do not compress: 3000 of them cost 56 KB of the 150 KB budget
-- (measured on a real 24 h window). A sequential integer costs 5.6 KB. The
-- UUID stays the primary key; seq is only a compact public handle.
--
-- Ingest and the seed name their insert columns, so identity fills this in.
-- An upsert that updates still draws a number, so there are gaps; at ~50k
-- draws a day a uint32 lasts two centuries.
-- ---------------------------------------------------------------------------
alter table public.stories add column seq bigint generated always as identity;
alter table public.stories add constraint stories_seq_key unique (seq);

-- ---------------------------------------------------------------------------
-- api_nodes: the payload's columns, built in SQL so one call returns one row
-- (PostgREST's 1000-row cap never applies) and the Worker receives the compact
-- form, which keeps database egress down.
--
-- The window ends at the newest story (first seen or published), not at now():
-- the result is then a pure function of the data, so the same data gives the
-- same bytes and the same hash. `p_known` is the hash the caller already has;
-- when nothing changed, only the hash comes back.
--
--   lonQ = round(lon / 180 * 32767), latQ = round(lat / 90 * 32767)
--   t    = whole seconds since generated_at - window_hours * 3600
--
-- The top p_limit stories by heat are returned in time order (then seq), so a
-- scrubber can treat the pins visible at any instant as a prefix. Columns go
-- through array_to_json, which writes no spaces; json_agg writes ", " between
-- elements, 30 KB of egress on 3000 nodes.
-- ---------------------------------------------------------------------------
create function public.api_nodes(p_hours integer, p_limit integer, p_known text default null)
returns json
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_end    timestamptz;
  v_gen    bigint;
  v_start  bigint;
  v_body   json;
  v_hash   text;
begin
  -- Safety bounds for a function any client can call, not product limits:
  -- the history window and node count are Worker config (tier boundaries).
  if p_hours is null or p_hours not between 1 and 720 then
    raise exception 'p_hours must be 1 to 720, got %', p_hours using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 10000 then
    raise exception 'p_limit must be 1 to 10000, got %', p_limit using errcode = '22023';
  end if;

  select greatest(max(s.first_seen_at), max(s.published_at)) into v_end from public.stories s;
  v_end := coalesce(v_end, now());
  v_gen := floor(extract(epoch from v_end))::bigint;
  v_start := v_gen - p_hours::bigint * 3600;

  with picked as (
    select s.seq, s.lon, s.lat, s.category, s.heat, s.source_count, s.discussion_state,
           s.title, s.place_name,
           floor(extract(epoch from s.published_at))::bigint - v_start as t
    from public.stories s
    where s.published_at > to_timestamp(v_start) and s.published_at <= v_end
    order by s.heat desc, s.published_at desc, s.seq desc
    limit p_limit
  )
  select json_build_object(
    'generated_at', v_gen,
    'window_hours', p_hours,
    'nodes', json_build_object(
      'id',   coalesce(array_to_json(array_agg(p.seq order by p.t, p.seq)), '[]'),
      'lonQ', coalesce(array_to_json(array_agg(round(p.lon / 180 * 32767)::integer order by p.t, p.seq)), '[]'),
      'latQ', coalesce(array_to_json(array_agg(round(p.lat / 90 * 32767)::integer order by p.t, p.seq)), '[]'),
      't',    coalesce(array_to_json(array_agg(p.t order by p.t, p.seq)), '[]'),
      'cat',  coalesce(array_to_json(array_agg(p.category order by p.t, p.seq)), '[]'),
      'heat', coalesce(array_to_json(array_agg(p.heat order by p.t, p.seq)), '[]'),
      'srcN', coalesce(array_to_json(array_agg(p.source_count order by p.t, p.seq)), '[]'),
      'disc', coalesce(array_to_json(array_agg((p.discussion_state = 'open')::integer order by p.t, p.seq)), '[]'),
      'hl',   coalesce(array_to_json(array_agg(p.title order by p.t, p.seq)), '[]'),
      'pl',   coalesce(array_to_json(array_agg(coalesce(p.place_name, '') order by p.t, p.seq)), '[]')
    )
  )
  into v_body
  from picked p;

  v_hash := md5(v_body::text);
  if v_hash = p_known then
    return json_build_object('hash', v_hash);
  end if;
  return json_build_object('hash', v_hash, 'payload', v_body);
end;
$$;

-- ---------------------------------------------------------------------------
-- api_story: one story in full, by seq (the payload's id) or by UUID. Null
-- when it does not exist. Articles come newest first; a story can gather
-- hundreds in a day (196 in two hours on 2026-09-24), so the list is capped
-- and article_count is the true total.
-- ---------------------------------------------------------------------------
create function public.api_story(
  p_seq bigint default null,
  p_id uuid default null,
  p_article_limit integer default 1000
)
returns json
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_story public.stories;
begin
  if p_article_limit is null or p_article_limit not between 1 and 5000 then
    raise exception 'p_article_limit must be 1 to 5000, got %', p_article_limit
      using errcode = '22023';
  end if;

  select s.* into v_story
  from public.stories s
  where (p_seq is not null and s.seq = p_seq) or (p_id is not null and s.id = p_id)
  limit 1;
  if not found then
    return null;
  end if;

  return json_build_object(
    'id', v_story.id,
    'seq', v_story.seq,
    'title', v_story.title,
    'summary', v_story.summary,
    'category', v_story.category,
    'heat', v_story.heat,
    'sentiment', v_story.sentiment,
    'source_count', v_story.source_count,
    'published_at', v_story.published_at,
    'first_seen_at', v_story.first_seen_at,
    -- "Why this location": where the coordinates came from and how sure.
    'place', json_build_object(
      'name', v_story.place_name,
      'lat', v_story.lat,
      'lon', v_story.lon,
      'source', v_story.place_source,
      'confidence', v_story.place_conf,
      'country_code', v_story.country_code
    ),
    'discussion', json_build_object('state', v_story.discussion_state),
    'article_count', (select count(*) from public.articles a where a.story_id = v_story.id),
    'articles', coalesce((
      select json_agg(x order by x.published_at desc nulls last, x.url)
      from (
        select a.outlet, a.outlet_country, a.headline, a.url, a.published_at, a.snippet
        from public.articles a
        where a.story_id = v_story.id
        order by a.published_at desc nulls last, a.url
        limit p_article_limit
      ) x
    ), '[]')
  );
end;
$$;

-- The only functions a client role may call (01_structure.test.sql keeps the
-- list exact). Read-only, and RLS applies because they run as the caller.
revoke all on function
  public.api_nodes(integer, integer, text),
  public.api_story(bigint, uuid, integer)
from public, anon, authenticated;

grant execute on function
  public.api_nodes(integer, integer, text),
  public.api_story(bigint, uuid, integer)
to anon, authenticated, service_role;
