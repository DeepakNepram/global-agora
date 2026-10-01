-- Story UI (Prompt 3.3): a discussion's participant count for the Discuss
-- button, and anonymous "wrong location" reports.
--
-- Both are counts a signed-out visitor may see or bump without being able to
-- read what they count: posts and the reports table stay closed to clients,
-- and two SECURITY DEFINER functions expose exactly one number each.

-- ---------------------------------------------------------------------------
-- Participants: people with a visible post. Posts are unreadable signed out
-- (and only partly readable signed in), so api_story, which runs as the
-- caller, cannot count them itself; this function runs as its owner and
-- returns the count alone, never who or what.
-- ---------------------------------------------------------------------------
create function public.discussion_participants(p_story uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct p.author_id)::integer
  from public.posts p
  where p.story_id = p_story and p.mod_state = 'ok'
$$;

-- ---------------------------------------------------------------------------
-- story_location_reports: how many readers said a story's pin is in the wrong
-- place. A counter, not a log: no reporter, no text, no IP. The admin
-- correction tool (Prompt 4.6) reads it with the service role.
-- ---------------------------------------------------------------------------
create table public.story_location_reports (
  -- Cascade: a report is about a pin, and goes when the story is pruned.
  story_id          uuid primary key references public.stories (id) on delete cascade,
  reports           integer not null default 1 check (reports >= 1),
  first_reported_at timestamptz not null default now(),
  last_reported_at  timestamptz not null default now()
);

-- Most-reported first, for the correction queue.
create index story_location_reports_reports_idx
  on public.story_location_reports (reports desc);

-- Service role only, as for story_signals: no grants to client roles, and a
-- restrictive policy so a grant added by mistake still reads nothing.
alter table public.story_location_reports enable row level security;

create policy "story_location_reports: service role only"
  on public.story_location_reports as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);

-- One report: by seq (the payload's id) or UUID, like api_story. False when
-- there is no such story. Anyone can call it, so the most it can do is add
-- one to a counter; the count saturates rather than overflowing.
create function public.api_report_location(
  p_seq bigint default null,
  p_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select s.id into v_id
  from public.stories s
  where (p_seq is not null and s.seq = p_seq) or (p_id is not null and s.id = p_id)
  limit 1;
  if v_id is null then
    return false;
  end if;

  insert into public.story_location_reports as r (story_id)
  values (v_id)
  on conflict (story_id) do update
    set reports = least(r.reports, 2147483646) + 1,
        last_reported_at = now();
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- api_story gains discussion.participants: the count for an open or closed
-- discussion, null when there is none. Everything else is unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.api_story(
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
    'discussion', json_build_object(
      'state', v_story.discussion_state,
      'participants', case
        when v_story.discussion_state in ('open', 'closed')
          then public.discussion_participants(v_story.id)
      end
    ),
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

-- Client roles may call these two as well as api_nodes and api_story
-- (01_structure.test.sql keeps the list exact). api_story calls
-- discussion_participants as the caller, so the caller needs EXECUTE on it.
revoke all on function
  public.discussion_participants(uuid),
  public.api_report_location(bigint, uuid)
from public, anon, authenticated;

grant execute on function
  public.discussion_participants(uuid),
  public.api_report_location(bigint, uuid)
to anon, authenticated, service_role;
