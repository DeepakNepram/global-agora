-- The admin console (Prompt 4.6): the hot story queue, opening a discussion
-- under a cap on how many are open at once, the counters, and correcting a
-- story's location. The moderation queue it also shows is 4.3's.
--
-- The role check is private.is_admin() (20261017130000). Every path here is
-- a SECURITY DEFINER function that checks it first; the tables they write
-- stay closed to client roles, so there is no direct write that could skip
-- the cap or the log.

-- ---------------------------------------------------------------------------
-- Settings: one row. Tune with `update private.admin_settings set ...`.
-- ---------------------------------------------------------------------------
create table private.admin_settings (
  id                   boolean primary key default true check (id),
  -- The most discussions open at once: what keeps moderation survivable.
  max_open_discussions smallint not null default 25 check (max_open_discussions between 1 and 1000),
  discussion_length    interval not null default interval '48 hours'
                         check (discussion_length > interval '0'),
  -- How far back the counters' median time to act on a report looks.
  report_median_window interval not null default interval '7 days'
                         check (report_median_window > interval '0')
);

insert into private.admin_settings default values;

alter table private.admin_settings enable row level security;
revoke all on private.admin_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A debate's words fit the discussion panel's header: one line each, the
-- prompt at most 200 characters, a side at most 40.
-- ---------------------------------------------------------------------------
alter table public.discussions
  add constraint discussions_prompt_shape
    check (char_length(prompt) <= 200 and prompt !~ '[\r\n]'),
  add constraint discussions_side_a_shape
    check (char_length(side_a_label) <= 40 and side_a_label !~ '[\r\n]'),
  add constraint discussions_side_b_shape
    check (char_length(side_b_label) <= 40 and side_b_label !~ '[\r\n]');

-- ---------------------------------------------------------------------------
-- What admins did to stories, and when. Moderation decisions on posts have
-- their own log (moderation_actions, 4.3).
-- ---------------------------------------------------------------------------
create table public.admin_actions (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null check (action in ('open_discussion', 'fix_location')),
  -- Set null: a corrected story is still pruned at 48 hours, and its record
  -- of who moved it stays.
  story_id   uuid references public.stories (id) on delete set null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_actions_created_idx on public.admin_actions (created_at);

alter table public.admin_actions enable row level security;

create policy "admin actions: service role only"
  on public.admin_actions as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- The hot story queue: stories the ingest queued (heat crossed the line),
-- hottest first.
-- ---------------------------------------------------------------------------
create function public.admin_story_queue(p_limit integer default 100)
returns table (
  story_id         uuid,
  seq              bigint,
  title            text,
  summary          text,
  place_name       text,
  country_code     text,
  heat             smallint,
  source_count     smallint,
  published_at     timestamptz,
  location_reports integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'p_limit must be 1 to 500, got %', p_limit using errcode = '22023';
  end if;

  return query
  select s.id, s.seq, s.title, s.summary, s.place_name, s.country_code::text, s.heat,
         s.source_count, s.published_at, coalesce(r.reports, 0)
    from public.stories s
    left join public.story_location_reports r on r.story_id = s.id
   where s.discussion_state = 'queued'
   order by s.heat desc, s.published_at desc, s.seq desc
   limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the debate suggestion is written from: the headline, the snippet, the
-- place and up to eight outlets' headlines, newest first. Never post text or
-- anything about a reader. The suggest-debate Edge Function calls it as the
-- admin who asked, so a non-admin is refused before any model is called.
-- ---------------------------------------------------------------------------
create function public.admin_story_brief(p_story uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
begin
  if not private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  select s.* into v_story from public.stories s where s.id = p_story;
  if not found then
    raise exception 'no such story' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'title', v_story.title,
    'summary', v_story.summary,
    'place_name', v_story.place_name,
    'country_code', v_story.country_code,
    'published_at', v_story.published_at,
    'headlines', coalesce((
      select jsonb_agg(jsonb_build_object('outlet', h.outlet, 'headline', h.headline)
                       order by h.published_at desc nulls last, h.url)
        from (
          select o.*
            from (
              -- One headline per outlet: eight outlets say more than eight
              -- rewrites from one.
              select distinct on (coalesce(a.outlet, a.url)) a.outlet, a.headline, a.url,
                     a.published_at
                from public.articles a
               where a.story_id = v_story.id
               order by coalesce(a.outlet, a.url), a.published_at desc nulls last
            ) o
           order by o.published_at desc nulls last, o.url
           limit 8
        ) h
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Opening a discussion on a queued story, unless the cap is reached.
-- Refusals:
-- - 22023: the words do not fit (empty, too long, two lines, the same side);
-- - P0002: no such story; 55000: the story is not in the queue;
-- - PT409 (HTTP 409): the cap. Its detail is when the next discussion closes.
-- ---------------------------------------------------------------------------
create function public.open_discussion(
  p_story  uuid,
  p_prompt text,
  p_side_a text,
  p_side_b text
)
returns table (story_id uuid, closes_at timestamptz, open_count integer, max_open integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prompt   text := btrim(coalesce(p_prompt, ''));
  v_side_a   text := btrim(coalesce(p_side_a, ''));
  v_side_b   text := btrim(coalesce(p_side_b, ''));
  v_settings private.admin_settings;
  v_state    text;
  v_open     integer;
  v_next     timestamptz;
  v_closes   timestamptz;
begin
  if not private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  if char_length(v_prompt) not between 1 and 200 or v_prompt ~ '[\r\n]' then
    raise exception 'the prompt must be one line of 1 to 200 characters' using errcode = '22023';
  end if;
  if char_length(v_side_a) not between 1 and 40 or v_side_a ~ '[\r\n]'
     or char_length(v_side_b) not between 1 and 40 or v_side_b ~ '[\r\n]' then
    raise exception 'each side must be one line of 1 to 40 characters' using errcode = '22023';
  end if;
  if lower(v_side_a) = lower(v_side_b) then
    raise exception 'the two sides must differ' using errcode = '22023';
  end if;

  -- One opening at a time: two admins at 24 open cannot both take the 25th.
  perform pg_advisory_xact_lock(hashtextextended('open_discussion', 0));

  select s.discussion_state into v_state from public.stories s where s.id = p_story for update;
  if not found then
    raise exception 'no such story' using errcode = 'P0002';
  end if;
  if v_state <> 'queued' then
    raise exception '%', case v_state
        when 'open' then 'this story''s discussion is already open'
        when 'closed' then 'this story''s discussion has closed'
        else 'this story is not in the queue' end
      using errcode = '55000';
  end if;

  select a.* into strict v_settings from private.admin_settings a;
  -- A discussion past its close time no longer counts, though the
  -- close-discussions job may not have turned it yet.
  select count(*)::integer, min(d.closes_at) into v_open, v_next
    from public.discussions d
   where d.state = 'open' and d.closes_at > now();
  if v_open >= v_settings.max_open_discussions then
    raise exception '% discussions are open, the most at once.', v_settings.max_open_discussions
      using errcode = 'PT409', detail = v_next::text;
  end if;

  v_closes := now() + v_settings.discussion_length;
  insert into public.discussions (story_id, prompt, side_a_label, side_b_label, opened_at, closes_at)
  values (p_story, v_prompt, v_side_a, v_side_b, now(), v_closes);
  update public.stories s set discussion_state = 'open' where s.id = p_story;
  insert into public.admin_actions (actor_id, action, story_id, detail)
  values (auth.uid(), 'open_discussion', p_story,
          jsonb_build_object('prompt', v_prompt, 'side_a', v_side_a, 'side_b', v_side_b));

  return query select p_story, v_closes, v_open + 1, v_settings.max_open_discussions::integer;
end;
$$;

-- ---------------------------------------------------------------------------
-- The counters. p_day_start is the admin's local midnight, sent by the page;
-- the median covers reports resolved within the settings' window.
-- ---------------------------------------------------------------------------
create function public.admin_counters(p_day_start timestamptz)
returns table (
  open_discussions      integer,
  max_open              integer,
  next_close_at         timestamptz,
  posts_today           integer,
  reports_open          integer,
  median_action_seconds double precision,
  reports_resolved      integer,
  median_window_days    integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings private.admin_settings;
begin
  if not private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  -- A local midnight is never in the future, nor more than a day and a
  -- daylight-saving hour ago; anything else is a bug in the caller.
  if p_day_start is null or p_day_start > now() or p_day_start < now() - interval '26 hours' then
    raise exception 'p_day_start must be within the last 26 hours, got %', p_day_start
      using errcode = '22023';
  end if;
  select a.* into strict v_settings from private.admin_settings a;

  return query
  with open_now as (
    select count(*)::integer as n, min(d.closes_at) as next_at
      from public.discussions d
     where d.state = 'open' and d.closes_at > now()
  ), resolved as (
    select count(*)::integer as n,
           percentile_cont(0.5) within group (
             order by extract(epoch from r.resolved_at - r.created_at)::double precision) as median
      from public.reports r
     where r.state in ('actioned', 'dismissed')
       and r.resolved_at >= now() - v_settings.report_median_window
  )
  select o.n, v_settings.max_open_discussions::integer, o.next_at,
         (select count(*)::integer from public.posts p where p.created_at >= p_day_start),
         (select count(*)::integer from public.reports w where w.state = 'open'),
         x.median, x.n,
         (extract(epoch from v_settings.report_median_window) / 86400)::integer
    from open_now o, resolved x;
end;
$$;

-- ---------------------------------------------------------------------------
-- The location correction tool's list: stories readers reported as in the
-- wrong place, most reported first. With p_seq (a pasted permalink's story),
-- that one story, reported or not.
-- ---------------------------------------------------------------------------
create function public.admin_location_queue(p_limit integer default 50, p_seq bigint default null)
returns table (
  story_id         uuid,
  seq              bigint,
  title            text,
  place_name       text,
  country_code     text,
  place_source     text,
  lat              double precision,
  lon              double precision,
  published_at     timestamptz,
  reports          integer,
  last_reported_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'p_limit must be 1 to 500, got %', p_limit using errcode = '22023';
  end if;

  return query
  select s.id, s.seq, s.title, s.place_name, s.country_code::text, s.place_source, s.lat, s.lon,
         s.published_at, coalesce(r.reports, 0), r.last_reported_at
    from public.stories s
    left join public.story_location_reports r on r.story_id = s.id
   where (p_seq is null and r.story_id is not null) or s.seq = p_seq
   order by r.reports desc nulls last, r.last_reported_at desc nulls last, s.seq desc
   limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Moving a story's pin. The place becomes 'manual', so the ingest keeps it
-- (ingest_apply below), and the readers' reports about it are answered.
-- Returns how many reports that was.
-- ---------------------------------------------------------------------------
create function public.fix_story_location(
  p_story        uuid,
  p_lat          double precision,
  p_lon          double precision,
  p_place_name   text,
  p_country_code text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place   text := nullif(btrim(coalesce(p_place_name, '')), '');
  v_country text := nullif(upper(btrim(coalesce(p_country_code, ''))), '');
  v_before  public.stories;
  v_reports integer;
begin
  if not private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  -- NaN and the infinities fail these too: Postgres sorts NaN above every number.
  if p_lat is null or p_lon is null
     or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'latitude must be -90 to 90 and longitude -180 to 180' using errcode = '22023';
  end if;
  if v_place is not null and (char_length(v_place) > 120 or v_place ~ '[\r\n]') then
    raise exception 'the place name must be one line of at most 120 characters'
      using errcode = '22023';
  end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'the country must be a two-letter code' using errcode = '22023';
  end if;

  select s.* into v_before from public.stories s where s.id = p_story for update;
  if not found then
    raise exception 'no such story' using errcode = 'P0002';
  end if;

  update public.stories s
     set lat = p_lat, lon = p_lon, place_name = v_place, country_code = v_country,
         place_source = 'manual', place_conf = 100
   where s.id = p_story;
  delete from public.story_location_reports r where r.story_id = p_story
  returning r.reports into v_reports;
  insert into public.admin_actions (actor_id, action, story_id, detail)
  values (auth.uid(), 'fix_location', p_story, jsonb_build_object(
    'from', jsonb_build_object('lat', v_before.lat, 'lon', v_before.lon,
                               'place_name', v_before.place_name,
                               'country_code', v_before.country_code,
                               'place_source', v_before.place_source),
    'to', jsonb_build_object('lat', p_lat, 'lon', p_lon, 'place_name', v_place,
                             'country_code', v_country),
    'reports', coalesce(v_reports, 0)));
  return coalesce(v_reports, 0);
end;
$$;

revoke all on function
  public.admin_story_queue(integer),
  public.admin_story_brief(uuid),
  public.open_discussion(uuid, text, text, text),
  public.admin_counters(timestamptz),
  public.admin_location_queue(integer, bigint),
  public.fix_story_location(uuid, double precision, double precision, text, text)
  from public, anon, authenticated;
-- Signed-in callers; each refuses anyone who is not an admin.
grant execute on function
  public.admin_story_queue(integer),
  public.admin_story_brief(uuid),
  public.open_discussion(uuid, text, text, text),
  public.admin_counters(timestamptz),
  public.admin_location_queue(integer, bigint),
  public.fix_story_location(uuid, double precision, double precision, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- The ingest keeps a corrected location. Until now only a story past 'none'
-- kept its place; one an admin moved while it was still 'none' would have
-- gone back on the next batch. Otherwise as in 20260924120000.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_apply(p_batch jsonb)
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
      lat          = case when s.discussion_state = 'none' and s.place_source is distinct from 'manual'
                          then excluded.lat else s.lat end,
      lon          = case when s.discussion_state = 'none' and s.place_source is distinct from 'manual'
                          then excluded.lon else s.lon end,
      place_name   = case when s.discussion_state = 'none' and s.place_source is distinct from 'manual'
                          then excluded.place_name else s.place_name end,
      place_conf   = case when s.discussion_state = 'none' and s.place_source is distinct from 'manual'
                          then excluded.place_conf else s.place_conf end,
      country_code = case when s.discussion_state = 'none' and s.place_source is distinct from 'manual'
                          then excluded.country_code else s.country_code end,
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
