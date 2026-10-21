-- Prompt 4.5: the live discussion feed. A post appears in an open discussion
-- as soon as it is approved, and leaves as soon as it stops being visible,
-- for everyone reading, signed in or not.
--
-- The database broadcasts only the post's id on the public Realtime topic
-- `discussion:<story uuid>`; each client then fetches the post through
-- PostgREST as itself, so blocks in both directions and moderation still
-- apply to what it shows. postgres_changes on posts would do neither well:
-- every vote is an UPDATE on posts, so every viewer would also receive every
-- vote and spend Realtime messages on it (2M a month on the free tier), and
-- Realtime would check RLS once per subscriber on every change.
--
-- The room's "where it stands" strip reads its counts from
-- discussion_balance, which runs as the caller for the same reason.

-- ---------------------------------------------------------------------------
-- The balance: approved posts per side.
-- ---------------------------------------------------------------------------

-- Invoker on purpose (unlike discussion_participants, 20261001100000): the
-- posts RLS drops authors blocked in either direction, so the counts match
-- the posts the reader can see. The explicit mod_state filter also drops the
-- caller's own pending or hidden posts, which RLS shows to their author.
create function public.discussion_balance(p_story uuid)
returns table (stance text, posts bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.stance, count(*)
    from public.posts p
   where p.story_id = p_story and p.mod_state = 'ok'
   group by p.stance
   order by p.stance;
$$;

revoke all on function public.discussion_balance(uuid) from public, anon, authenticated;
grant execute on function public.discussion_balance(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The broadcast: 'post' when a post becomes visible, 'gone' when it stops.
-- ---------------------------------------------------------------------------

-- The one place that talks to Realtime, with realtime.send's own signature.
-- realtime.send exists only where Realtime is set up (the CLI installs its
-- schema only while config.toml enables it), and posting must never fail
-- for want of a broadcast. Being ours, it also lets pgTAP put a recorder in
-- its place: the realtime schema belongs to supabase_admin, so a test, run
-- as postgres, can neither replace realtime.send nor create a stand-in there.
create function private.realtime_send(payload jsonb, event text, topic text, private boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
    perform realtime.send(payload, event, topic, private);
  end if;
end;
$$;

revoke all on function private.realtime_send(jsonb, text, text, boolean)
  from public, anon, authenticated;

-- Visible means approved: inserted as 'ok' (the service role and fixtures),
-- or moved to 'ok' later by the moderation services or a moderator (from
-- pending, or from hidden). Leaving 'ok' (a moderator acting on a report) or
-- being deleted while 'ok' (its discussion or its author's account went)
-- sends 'gone'. A public topic (private => false) needs no Realtime RLS: the id
-- alone tells a listener nothing it could not fetch.
create function private.posts_broadcast()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was boolean := tg_op <> 'INSERT' and old.mod_state = 'ok';
  v_is boolean := tg_op <> 'DELETE' and new.mod_state = 'ok';
begin
  if v_was = v_is then
    return null;
  end if;
  if v_is then
    perform private.realtime_send(jsonb_build_object('id', new.id), 'post',
                                  'discussion:' || new.story_id::text, false);
  else
    perform private.realtime_send(jsonb_build_object('id', old.id), 'gone',
                                  'discussion:' || old.story_id::text, false);
  end if;
  return null;
end;
$$;

revoke all on function private.posts_broadcast() from public, anon, authenticated;

-- The WHEN clauses skip the call for rows that cannot change visibility.
-- Votes update only the counts, so `update of mod_state` never fires for them.
create trigger posts_broadcast_insert after insert on public.posts
  for each row when (new.mod_state = 'ok')
  execute function private.posts_broadcast();
create trigger posts_broadcast_update after update of mod_state on public.posts
  for each row when (old.mod_state is distinct from new.mod_state)
  execute function private.posts_broadcast();
create trigger posts_broadcast_delete after delete on public.posts
  for each row when (old.mod_state = 'ok')
  execute function private.posts_broadcast();
