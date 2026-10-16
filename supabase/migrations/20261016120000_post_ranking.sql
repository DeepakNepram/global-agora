-- Post ranking (Prompt 4.2): help that crosses sides counts for more than
-- help from your own side, and changing someone's mind counts most.
--
--   cross_side_ratio = cross_side_count / greatest(helpful_count, 1)
--   rank_score = ln(1 + helpful_count) * (0.5 + cross_side_ratio)
--              + 1.5 * ln(1 + changed_mind_count)
--
-- A post every vote came to from one side earns half weight on its helpful
-- votes; one whose helpful votes all came from the other side earns one and
-- a half. ln() flattens raw popularity, so 20 one-sided votes (rank 1.52)
-- stay below 4 cross-side ones (2.41).
--
-- rank_score is a generated column over this one function: a vote's trigger
-- (20261016110000) changes the counts, and Postgres recomputes the rank in
-- the same statement. Nothing can write a rank any other way, not the
-- service role, not an admin.
--
-- No boost for Expert (Prompt 4.2: "enforce the no-boost rule in the ranking
-- function itself"): the function is given the three counts and nothing
-- else, so a post's kind cannot reach its rank. Expert posts are labelled
-- "unverified" in the UI (Prompt 4.5).

create function private.post_rank(p_helpful integer, p_cross_side integer, p_changed_mind integer)
returns real
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (
    ln(1 + p_helpful) * (0.5 + p_cross_side::double precision / greatest(p_helpful, 1))
    + 1.5 * ln(1 + p_changed_mind)
  )::real;
$$;

-- A generated column is computed as the inserting role (checked: without
-- this a client's post is refused), so signed-in readers may call it. Guests
-- only read the stored value. private is not an API schema: no endpoint.
revoke all on function private.post_rank(integer, integer, integer) from public, anon, authenticated;
grant execute on function private.post_rank(integer, integer, integer) to authenticated;

drop index public.posts_story_rank_idx;
alter table public.posts drop column rank_score;
alter table public.posts
  add column rank_score real not null
  generated always as (private.post_rank(helpful_count, cross_side_count, changed_mind_count)) stored;

-- A discussion's posts, best first.
create index posts_story_rank_idx on public.posts (story_id, rank_score desc);

grant select (rank_score) on public.posts to anon, authenticated;
