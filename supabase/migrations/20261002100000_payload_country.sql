-- The payload gains the place's country (Prompt 3.4): `cc`, ISO 3166-1 alpha-2
-- per node, "" when unknown. Following a country matches on it exactly,
-- rather than on GDELT's English country names in `pl`. Everything else in
-- api_nodes is unchanged (20260924140000_api.sql explains it); `create or
-- replace` keeps its grants.

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
           s.title, s.place_name, s.country_code,
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
