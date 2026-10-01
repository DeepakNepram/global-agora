-- Outlet search (Prompt 3.4): which outlets cover the globe's stories, and
-- one outlet's stories. Both read the same stories as the payload, so a
-- search result never points at a story the globe does not have.
--
-- Measured on a real day, an index carrying every outlet's story ids would
-- outgrow its 40 KB budget (20 KB for four hours alone), so it is split: the
-- names and counts are fetched when search opens, and one outlet's ids when
-- it is chosen.

-- ---------------------------------------------------------------------------
-- api_window: the payload's stories, defined once. The top p_limit by heat
-- among those published in the p_hours before the newest story (first seen or
-- published), exactly as 20260924140000_api.sql explains. api_nodes now reads
-- its stories from here too.
-- ---------------------------------------------------------------------------
create function public.api_window(p_hours integer, p_limit integer)
returns table (story_id uuid, seq bigint, published_at timestamptz, window_end timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_end   timestamptz;
  v_start bigint;
begin
  -- Safety bounds for a function any client can call, not product limits.
  if p_hours is null or p_hours not between 1 and 720 then
    raise exception 'p_hours must be 1 to 720, got %', p_hours using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 10000 then
    raise exception 'p_limit must be 1 to 10000, got %', p_limit using errcode = '22023';
  end if;

  select greatest(max(s.first_seen_at), max(s.published_at)) into v_end from public.stories s;
  v_end := coalesce(v_end, now());
  v_start := floor(extract(epoch from v_end))::bigint - p_hours::bigint * 3600;

  return query
    select s.id, s.seq, s.published_at, v_end
    from public.stories s
    where s.published_at > to_timestamp(v_start) and s.published_at <= v_end
    order by s.heat desc, s.published_at desc, s.seq desc
    limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- api_nodes, unchanged in what it returns, now over api_window.
-- ---------------------------------------------------------------------------
create or replace function public.api_nodes(p_hours integer, p_limit integer, p_known text default null)
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
           s.title, s.place_name, s.country_code,
           floor(extract(epoch from s.published_at))::bigint - v_start as t
    from public.api_window(p_hours, p_limit) w
    join public.stories s on s.id = w.story_id
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
      'pl',   coalesce(array_to_json(array_agg(coalesce(p.place_name, '') order by p.t, p.seq)), '[]'),
      'cc',   coalesce(array_to_json(array_agg(coalesce(p.country_code::text, '') order by p.t, p.seq)), '[]')
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
-- api_outlets: every outlet with an article on a window story, and how many
-- of those stories it covers, most first (then by name). Same hash protocol
-- as api_nodes: a caller with the current hash gets the hash alone.
-- ---------------------------------------------------------------------------
create function public.api_outlets(p_hours integer, p_limit integer, p_known text default null)
returns json
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_gen  bigint;
  v_body json;
  v_hash text;
begin
  select floor(extract(epoch from coalesce(
           greatest(max(s.first_seen_at), max(s.published_at)), now())))::bigint
    into v_gen from public.stories s;

  with counted as (
    select a.outlet, count(distinct a.story_id) as n
    from public.api_window(p_hours, p_limit) w
    join public.articles a on a.story_id = w.story_id
    where a.outlet is not null and a.outlet <> ''
    group by a.outlet
  )
  select json_build_object(
    'generated_at', v_gen,
    'window_hours', p_hours,
    'outlets', coalesce(array_to_json(array_agg(c.outlet order by c.n desc, c.outlet)), '[]'),
    'n',       coalesce(array_to_json(array_agg(c.n order by c.n desc, c.outlet)), '[]')
  )
  into v_body
  from counted c;

  v_hash := md5(v_body::text);
  if v_hash = p_known then
    return json_build_object('hash', v_hash);
  end if;
  return json_build_object('hash', v_hash, 'payload', v_body);
end;
$$;

-- ---------------------------------------------------------------------------
-- api_outlet_stories: one outlet's window stories, newest first, as payload
-- ids. An outlet with none gets an empty list.
-- ---------------------------------------------------------------------------
create function public.api_outlet_stories(p_outlet text, p_hours integer, p_limit integer)
returns json
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ids json;
begin
  if p_outlet is null or char_length(p_outlet) not between 1 and 120 then
    raise exception 'p_outlet must be 1 to 120 characters' using errcode = '22023';
  end if;

  select coalesce(array_to_json(array_agg(w.seq order by w.published_at desc, w.seq desc)), '[]')
    into v_ids
    from public.api_window(p_hours, p_limit) w
   where exists (
     select 1 from public.articles a where a.story_id = w.story_id and a.outlet = p_outlet
   );
  return json_build_object('outlet', p_outlet, 'ids', v_ids);
end;
$$;

-- Callable by clients like the other reads (01_structure.test.sql keeps the
-- list exact). api_window must be: the reads run as the caller and call it.
revoke all on function
  public.api_window(integer, integer),
  public.api_outlets(integer, integer, text),
  public.api_outlet_stories(text, integer, integer)
from public, anon, authenticated;

grant execute on function
  public.api_window(integer, integer),
  public.api_outlets(integer, integer, text),
  public.api_outlet_stories(text, integer, integer)
to anon, authenticated, service_role;
